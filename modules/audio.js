import { defer, fetchFromCache } from './utils.js';

const decodeBase64 = Uint8Array.fromBase64
	? (base64) => Uint8Array.fromBase64(base64)
	: (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const dataURIToBuffer = (dataURI) => decodeBase64(dataURI.slice(dataURI.indexOf(',') + 1)).buffer;

export class Audio {
	static #idleDelay   = 10;

	#bus;
	#events;
	#gains;
	#worker;
	#sounds;
	#maxGain;
	#gainNodes;
	#dataCache;
	#soundsFile;
	#masterGain;
	#workerReady;
	#emptyStroke;
	#audioStream;
	#audioContext;
	#hiddenPlayDuration;

	#wakeLock         = null;
	#playTimer        = null;
	#audioReady       = null;
	#instruments      = [];
	#lastNoteTime     = 0;
	#activeSources    = new Set();

	constructor({ bus, config, initial = {} }) {
		this.#bus                 = bus;
		this.#events              = config.events;
		this.#maxGain             = config.maxGain;
		this.#dataCache           = config.dataCache;
		this.#soundsFile          = config.instrumentsSoundsFile;
		this.#emptyStroke         = config.emptyStroke;
		this.#hiddenPlayDuration  = config.hiddenPlayDuration;
		this.#gains               = Array.from({ length: config.tracksLength }, () => config.defaultGain / config.maxGain);

		this.#bus.addEventListener(this.#events.navigationDecoded,       ({ detail }) => this.#updateData(detail, true));
		this.#bus.addEventListener(this.#events.interfaceReset,          () => this.#reset());
		this.#bus.addEventListener(this.#events.interfaceChange,         ({ detail }) => this.#change(detail));
		this.#bus.addEventListener(this.#events.interfaceMoveTrack,      ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener(this.#events.interfaceSetStroke,      ({ detail }) => this.#setStroke(detail));
		this.#bus.addEventListener(this.#events.interfaceUpdateData,     ({ detail }) => this.#updateData(detail));
		this.#bus.addEventListener(this.#events.interfaceUserGesture,    () => this.#startAudio(), { once: true });
		this.#bus.addEventListener(this.#events.interfacePresetSelected, () => this.#restart());
		document.addEventListener('visibilitychange',         () => this.#handleVisibilityChange());

		this.#worker           = new Worker(new URL('./audio_worker.js', import.meta.url));
		this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);

		this.#workerReady = this.#configureWorker(config);
		this.#updateData(initial, true);

		this.#sounds = this.#fetchInstrumentSounds(config.dataCache, config.instrumentsSoundsFile);

		defer(() => this.#ensureAudio());
		defer(() => this.#ensureAudioStream());
	}

	async #configureWorker(config) {
		const { instruments } = await config.instrumentsLibraryReady;
		const instrumentsStrokes = Object.fromEntries(
			instruments.map(({ id, strokes }) => [id, strokes.length])
		);
		this.#worker.postMessage({
			action: 'config',
			payload: {
				tempo:         config.defaultTempo,
				maxBars:       config.maxBars,
				synchroBar:    config.defaultBars,
				resolution:    config.resolution,
				emptyStroke:   config.emptyStroke,
				tracksLength:  config.tracksLength,
				defaultData:   {
					bars:       config.defaultBars,
					beats:      config.defaultBeats,
					steps:      config.defaultSteps,
					phrase:     config.defaultPhrase,
					volume:     config.defaultGain,
					instrument: config.defaultInstrument,
				},
				instrumentsStrokes,
			},
		});
	}

	#post(message) {
		this.#workerReady.then(() => this.#worker.postMessage(message));
	}

	#ensureAudio() {
		return this.#audioReady ??= this.#initAudio();
	}

	async #initAudio() {
		this.#audioContext = new AudioContext();
		this.#audioContext.addEventListener('statechange', () => this.#handleAudioStateChange());

		this.#masterGain = new GainNode(this.#audioContext);
		this.#masterGain.connect(this.#audioContext.destination);

		this.#gainNodes = this.#gains.map((gain) => {
			const gainNode = new GainNode(this.#audioContext, { gain });
			gainNode.connect(this.#masterGain);
			return gainNode;
		});

		await this.#decodeInstrumentSounds(await this.#sounds);
	}

	#ensureAudioStream() {
		return this.#audioStream ??= this.#createAudioStream();
	}

	#createAudioStream() {
		const volume = 1000;
		const frequency = 20;
		const sampleRate = 8000;
		const length = sampleRate * 10;
		const header = new ArrayBuffer(44);
		const view = new DataView(header);
		const writeString = (offset, string) => {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i));
			}
		};
		writeString(0, 'RIFF');
		view.setUint32(4, 36 + length * 2, true);
		writeString(8, 'WAVE');
		writeString(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		writeString(36, 'data');
		view.setUint32(40, length * 2, true);
		const samplesPerCycle = sampleRate / frequency;
		const cycleData = new Int16Array(samplesPerCycle);
		const step = (2 * Math.PI * frequency) / sampleRate;
		for (let i = 0; i < samplesPerCycle; i++) {
			cycleData[i] = Math.sin(i * step) * volume;
		}
		const pcmData = new Int16Array(length);
		for (let i = 0; i < length; i += samplesPerCycle) {
			pcmData.set(cycleData, i);
		}
		const blob = new Blob([header, pcmData.buffer], { type: 'audio/wav' });
		const audioStream = new window.Audio(URL.createObjectURL(blob));
		audioStream.loop = true;
		audioStream.volume = 0.001;
		document.body.append(audioStream);
		return audioStream;
	}

	async #fetchInstrumentSounds(cacheName, fileName) {
		const response = await fetchFromCache(cacheName, fileName);
		const json = await response.json();
		return Object.entries(json).map(([id, sounds]) => [id, sounds.map(dataURIToBuffer)]);
	}

	async #decodeInstrumentSounds(sounds) {
		const entries = await Promise.all(
			sounds.map(async ([id, buffers]) => [
				id,
				await Promise.all(buffers.map((buffer) => this.#audioContext.decodeAudioData(buffer))),
			])
		);
		this.#instruments = Object.fromEntries(entries);
	}

	#handleWorkerMessage(data) {
		data.forEach(({ action, payload }) => {
			if (action === 'ticks') {
				this.#playTicks(payload);
			}
			else if (action === 'stop') {
				this.#stopAudio();
			}
			else if (action === 'updateData') {
				this.#bus.dispatchEvent(new CustomEvent(this.#events.audioUpdateData, { detail: payload }));
			}
			else if (action === 'updateGains') {
				this.#updateGains(payload);
			}
			else if (action === 'playNote') {
				const { instrument, gainIndex, stroke } = payload;
				this.#playNote(instrument, gainIndex, stroke);
			}
			else if (action === 'changed') {
				this.#bus.dispatchEvent(new CustomEvent(this.#events.audioChanged, { detail: payload }));
			}
			else if (action === 'state') {
				this.#bus.dispatchEvent(new CustomEvent(this.#events.audioState, { detail: payload }));
			}
		});
	}

	async #start() {
		await this.#startAudio();
		this.#ensureAudioStream().play().catch(() => {});
		this.#post({ action: 'start', payload: this.#audioContext.currentTime });
		this.#wakeLockRequest();
	}

	#startAudio() {
		this.#ensureAudio();
		return this.#audioContext.state !== 'running'
			? this.#audioContext.resume()
			: Promise.resolve();
	}

	#stop() {
		if (!this.#audioContext) return;
		this.#post({ action: 'stop', payload: this.#audioContext.currentTime });
		this.#muteSchedulesNotes();
		this.#stopAudio();
	}

	#stopAudio() {
		clearTimeout(this.#playTimer);
		this.#playTimer = null;
		this.#wakeLockRelease();
		if (this.#audioStream) {
			this.#audioStream.pause();
			this.#audioStream.currentTime = 0;
		}
		this.#bus.dispatchEvent(new CustomEvent(this.#events.audioStop));
	}

	#restart() {
		this.#post({ action: 'restart' });
	}

	#reset() {
		this.#post({ action: 'reset' });
		this.#muteSchedulesNotes();
	}

	#playTicks(ticks) {
		let hasStroke = false;
		const animations = new Map();
		const timeDelta = performance.now() - (this.#audioContext.currentTime * 1000);

		for (let i = 0; i < ticks.length; i += 5) {
			const time       = ticks[i];
			const stroke     = ticks[i + 1];
			const instrument = ticks[i + 2];
			const trackIndex = ticks[i + 3];
			const stepIndex  = ticks[i + 4];
			if (stroke > this.#emptyStroke) {
				hasStroke = true;
				this.#playNote(instrument, trackIndex, stroke, time);
			}
			if (!animations.has(trackIndex)) {
				animations.set(trackIndex, []);
			}
			animations.get(trackIndex).push({
				time: (time * 1000) + timeDelta,
				stepIndex,
				stroke,
			});
		}
		if (hasStroke) {
			this.#lastNoteTime = this.#audioContext.currentTime;
		}
		this.#bus.dispatchEvent(new CustomEvent(this.#events.audioPushAnimations, { detail: { animations } }));
	}

	async #setStroke(payload) {
		await this.#startAudio();
		this.#post({ action: 'setStroke', payload });
	}

	#change(payload) {
		this.#post({ action: 'change', payload });
	}

	#moveTrack(indexes) {
		this.#post({ action: 'moveTrack', payload: indexes });
	}

	#updateData(changes, sendState) {
		const { tempo, sheet, tracks, volumes, playing } = changes;
		if ((tempo ?? sheet ?? tracks ?? volumes ?? playing) === undefined) return;

		if (playing === true) this.#start();
		else if (playing === false) this.#stop();

		const payload = { tempo, sheet, tracks, volumes };
		payload.sendState = sendState === true;
		this.#post({ action: 'updateData', payload });

		if (volumes) this.#updateGains(volumes);
	}

	#updateGains(gains) {
		for (const { id, value } of gains) {
			this.#gains[id] = value / this.#maxGain;
			if (this.#gainNodes) this.#gainNodes[id].gain.value = this.#gains[id];
		}
	}

	#handleVisibilityChange() {
		if (!document.hidden && this.#playTimer) {
			clearTimeout(this.#playTimer);
			this.#playTimer = null;
			this.#wakeLockRequest();
		}
	}

	#handleAudioStateChange() {
		if (this.#audioContext.state !== 'running' && this.#playTimer !== null) {
			this.#stop();
		}
	}

	#playNote(instrument, gainIndex, stroke, time = this.#audioContext.currentTime) {
		const buffers = this.#instruments[instrument] || this.#instruments[0];
		if (!buffers) return;
		const buffer = buffers[stroke - 1] || buffers[0];
		const sound = new AudioBufferSourceNode(this.#audioContext, { buffer });
		sound.connect(this.#gainNodes[gainIndex]);
		this.#activeSources.add(sound);
		sound.onended = () => this.#activeSources.delete(sound);
		sound.start(time);
	}

	#muteSchedulesNotes() {
		if (!this.#audioContext) return;
		const fadeOut = 0.05;
		const now = this.#audioContext.currentTime;
		this.#masterGain.gain.cancelScheduledValues(now);
		this.#masterGain.gain.setValueAtTime(this.#masterGain.gain.value, now);
		this.#masterGain.gain.linearRampToValueAtTime(0, now + fadeOut);
		for (const source of this.#activeSources) {
			try { source.stop(now + fadeOut) } catch {}
		}
		this.#activeSources.clear();
		this.#masterGain.gain.setValueAtTime(0, now + fadeOut + 0.01);
		this.#masterGain.gain.linearRampToValueAtTime(1, now + fadeOut + 0.02);
	}

	async #wakeLockRequest() {
		clearTimeout(this.#playTimer);
		this.#playTimer = null;
		try {
			this.#wakeLock = await navigator.wakeLock.request();
			this.#wakeLock.onrelease = () => this.#setPlayTimer();
		} catch {
			this.#setPlayTimer();
		}
	}

	#setPlayTimer() {
		if (this.#audioContext.state !== 'running') return;
		this.#playTimer = setTimeout(() => {
			const isIdle = this.#audioContext.currentTime - this.#lastNoteTime > Audio.#idleDelay;
			const delay = isIdle ? 0 : Math.max(0, this.#hiddenPlayDuration - Audio.#idleDelay) * 1000;
			this.#playTimer = setTimeout(() => {
				this.#stop();
				this.#playTimer = null;
				this.#audioContext.suspend();
			}, delay);
		}, Audio.#idleDelay * 1000);
	}

	#wakeLockRelease() {
		if (this.#wakeLock !== null) {
			this.#wakeLock.onrelease = null;
			this.#wakeLock.release().then(() => this.#wakeLock = null);
		}
	}

}