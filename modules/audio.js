export class Audio {
	#bus;
	#maxGain;
	#gainNodes;
	#masterGain;
	#audioStream;
	#audioContext;
	#audioStreamBlob;
	#instrumentsList;
	#hiddenPlayDuration;
	#mediaPausedDuration;
	#worker           = null;
	#isReady          = false;
	#wakeLock         = null;
	#playTimer        = null;
	#activeSources    = new Set();
	#pendingMessages  = [];
	#mediaPausedTimer = null;

	constructor({ bus, config, instruments }) {
		this.#bus                 = bus;
		this.#instrumentsList     = instruments;
		this.#hiddenPlayDuration  = config.hiddenPlayDuration;
		this.#mediaPausedDuration = config.mediaPausedDuration;

		this.#bus.addEventListener('navigation:decoded',       ({ detail }) => this.#updateData(detail, true));
		this.#bus.addEventListener('interface:reset',          () => this.#reset());
		this.#bus.addEventListener('interface:change',         ({ detail }) => this.#change(detail));
		this.#bus.addEventListener('interface:moveTrack',      ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener('interface:setStroke',      ({ detail }) => this.#setStroke(detail));
		this.#bus.addEventListener('interface:updateData',     ({ detail }) => this.#updateData(detail));
		this.#bus.addEventListener('interface:userGesture',    () => this.#startAudio(), { once: true });
		this.#bus.addEventListener('interface:presetSelected', () => this.#restart());
		document. addEventListener('visibilitychange',         () => this.#handleVisibilityChange());

		queueMicrotask(() => {
			this.#worker           = new Worker(new URL('./audio_worker.js', import.meta.url));
			this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
			this.#initAudio(config);
			this.#initAudioStream(10);
		});
	}

	#initAudioStream(seconds) {
		const sampleRate = 8000;
		const length = sampleRate * seconds;
		const buffer = new ArrayBuffer(44 + length * 2);
		const view = new DataView(buffer);
		const writeString = (offset, string) => {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i));
			}
		};
		writeString(0, 'RIFF');
		view.setUint32(4, 36 + length * 2, true);
		writeString(8, 'WAVEfmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		writeString(36, 'data');
		view.setUint32(40, length * 2, true);
		this.#audioStreamBlob = new Blob([view], { type: 'audio/wav' });
		this.#audioStream = new window.Audio(URL.createObjectURL(this.#audioStreamBlob));
		this.#audioStream.loop = true;
	}

	async #initAudio(config) {
		this.#audioContext = new AudioContext();
		this.#masterGain = new GainNode(this.#audioContext);
		this.#masterGain.connect(this.#audioContext.destination);
		//const streamDestination  = this.#audioContext.createMediaStreamDestination();
		//this.#masterGain.connect(streamDestination);
		//this.#audioStream = new window.Audio();
		//this.#audioStream.srcObject = streamDestination.stream;
		this.#audioContext.addEventListener('statechange', () => this.#handleAudioStateChange());

		const loadInstruments    = this.#loadInstrumentSounds();
		const instrumentsStrokes = this.#instrumentsList.map(instrument => instrument.files.length || 1);

		this.#maxGain = config.maxGain;

		const workerConfig = {
			order:         config.defaultOrder,
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
		}

		this.#worker.postMessage({
			action: 'config',
			payload: workerConfig,
		});

		this.#gainNodes = Array.from({ length: config.tracksLength }, () => {
			const gainNode = new GainNode(this.#audioContext, { gain: config.defaultGain / config.maxGain });
			gainNode.connect(this.#masterGain);
			return gainNode;
		});

		await loadInstruments;
		this.#isReady = true; 
		this.#pendingMessages.forEach(message => this.#updateData(message.changes, message.sendState));
		this.#pendingMessages = [];
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
				this.#bus.dispatchEvent(
					new CustomEvent('audio:updateData', { detail: payload })
				);
			}
			else if (action === 'updateGains') {
				this.#updateGains(payload);
			}
			else if (action === 'playNote') {
				const { instrument, gainIndex, stroke } = payload;
				this.#playNote(instrument, gainIndex, stroke);
			}
			else if (action === 'changed') {
				this.#bus.dispatchEvent(
					new CustomEvent('audio:changed', { detail: payload })
				);
			}
			else if (action === 'state') {
				this.#bus.dispatchEvent(
					new CustomEvent('audio:state', { detail: payload })
				);
			}
		});
	}

	async #loadInstrumentSounds() {
		await Promise.all(this.#instrumentsList.map(async (instrument) => {
			instrument.sounds = await Promise.all(instrument.files.map(async (file) => {
				const response = await fetch(`audio/${file}`);
				const buffer = await response.arrayBuffer();
				return this.#audioContext.decodeAudioData(buffer);
			}));
		}));
		console.log('Audio sounds loaded');
	}

	async #start() {
		if (this.#mediaPausedTimer) {
			clearTimeout(this.#mediaPausedTimer);
			this.#mediaPausedTimer = null;
		}
		if (this.#audioContext.state !== 'running') {
			await this.#audioContext.resume();
		}
		await this.#startAudio();
		this.#audioStream.play().catch();
		this.#worker.postMessage({ action: 'start', payload: this.#audioContext.currentTime });
		this.#wakeLockRequest();
	}

	#startAudio() {
		return this.#audioContext.state !== 'running' 
			? this.#audioContext.resume() 
			: Promise.resolve();
	}

	#stop() {
		this.#worker.postMessage({ action: 'stop', payload: this.#audioContext.currentTime});
		this.#muteSchedulesNotes();
		this.#stopAudio();
	}

	#stopAudio() {
		this.#wakeLockRelease();
		this.#audioStream.pause();
		this.#audioStream.currentTime = 0;
		this.#bus.dispatchEvent(new CustomEvent('audio:stop'));
		this.#mediaPausedTimer = setTimeout(() => {
			this.#audioStream.removeAttribute('src');
			this.#audioStream.load();
			this.#audioStream.src = URL.createObjectURL(this.#audioStreamBlob);
			this.#mediaPausedTimer = null;
		}, this.#mediaPausedDuration * 1000);
	}

	#restart() {
		this.#worker.postMessage({ action: 'restart' });
	}

	#reset() {
		this.#worker.postMessage({ action: 'reset' });
		this.#muteSchedulesNotes();
	}

	#playTicks(ticks) {
		const animations = new Map();
		const timeDelta = performance.now() - (this.#audioContext.currentTime * 1000);

		for (let i = 0; i < ticks.length; i += 5) {
			const time       = ticks[i];
			const stroke     = ticks[i + 1];
			const instrument = ticks[i + 2];
			const trackIndex = ticks[i + 3];
			const stepIndex  = ticks[i + 4];
			if (stroke > 0) {
				this.#playNote(instrument, trackIndex, stroke, time);
			}
			if (!animations.has(trackIndex)) {
				animations.set(trackIndex, []);
			}
			animations.get(trackIndex).push({
				time: (time * 1000) + timeDelta,
				stepIndex
			});
		}
		this.#bus.dispatchEvent(new CustomEvent('audio:pushAnimations', { detail: { animations } }));
	}

	async #setStroke(payload) {
		await this.#startAudio();
		this.#worker.postMessage({ action: 'setStroke', payload });
	}

	#change(payload) {
		this.#worker.postMessage({ action: 'change', payload });
	}

	#moveTrack(indexes) {
		this.#worker.postMessage({ action: 'moveTrack', payload: indexes });
	}

	#updateData(changes, sendState) {
		const { tempo, sheet, tracks, volumes, playing } = changes;
		if ((tempo ?? sheet ?? tracks ?? volumes ?? playing) === undefined) return;

		if (!this.#isReady || !this.#worker) {
			this.#pendingMessages.push({ changes, sendState });
			return; 
		}

		if (playing === true) this.#start();
		else if (playing === false) this.#stop();

		const payload = { tempo, sheet, tracks, volumes };
		payload.sendState = sendState === true;
		this.#worker.postMessage({ action: 'updateData', payload });

		if (volumes) this.#updateGains(volumes);
	}

	#updateGains(gains) {
		for (const { id, value } of gains) {
			this.#gainNodes[id].gain.value = value / this.#maxGain;
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
		if (this.#audioContext.state !== 'running') {
			this.#stop();
		}
	}

	#playNote(instrument, gainIndex, stroke, time = this.#audioContext.currentTime) {
		const buffers = this.#instrumentsList[instrument].sounds;
		if (!buffers) return;
		const buffer = buffers[stroke - 1] || buffers[0];
		const sound = new AudioBufferSourceNode(this.#audioContext, { buffer });
		sound.connect(this.#gainNodes[gainIndex]);
		this.#activeSources.add(sound);
		sound.onended = () => this.#activeSources.delete(sound);
		sound.start(time);
	}

	#muteSchedulesNotes() {
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
		try {
			this.#wakeLock = await navigator.wakeLock.request();
			this.#wakeLock.onrelease = () => {
				if (this.#audioContext.state !== 'running') return;
				clearTimeout(this.#playTimer);
				this.#playTimer = setTimeout(() => {
					this.#audioContext.suspend();
					this.#playTimer = null;
				}, this.#hiddenPlayDuration * 1000);
			};
		} catch {}
	}

	#wakeLockRelease() {
		if (this.#wakeLock !== null) {
			this.#wakeLock.onrelease = null;
			this.#wakeLock.release().then(() => this.#wakeLock = null);
		}
	}

}
