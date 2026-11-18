import storage from '../config/storage.js';
import { fetchFromCache } from './utils.js';

const decodeBase64 = Uint8Array.fromBase64
	? (base64) => Uint8Array.fromBase64(base64)
	: (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const dataURIToBuffer = (dataURI) => decodeBase64(dataURI.slice(dataURI.indexOf(',') + 1)).buffer;

const toMono = (buffer) => {
	const { numberOfChannels: count, length, sampleRate } = buffer;
	if (count === 1) return buffer;
	const mono = new AudioBuffer({ length, sampleRate });
	const data = mono.getChannelData(0);
	for (let c = 0; c < count; c++) {
		const channel = buffer.getChannelData(c);
		for (let i = 0; i < length; i++) data[i] += channel[i] / count;
	}
	return mono;
};

const defer = (task, timeout = 3000) => {
	if (globalThis.scheduler?.postTask) {
		scheduler.postTask(task, { priority: 'background' }).catch(reportError);
	}
	else if ('requestIdleCallback' in globalThis) requestIdleCallback(task, { timeout });
	else setTimeout(task, 500);
}

export class Audio extends EventTarget {
	static #detuneRange = 10;

	#song;
	#worker;
	#sounds;
	#maxGain;
	#panNodes;
	#gainNodes;
	#resolution;
	#masterGain;
	#emptyStroke;
	#audioStream;
	#audioContext;
	#preferences;
	#defaultPreferences;

	#playing          = false;
	#wakeLock         = null;
	#audioReady       = null;
	#hiddenTimer      = null;
	#instruments      = {};
	#activeSources    = new Set();
	#panByInstrument  = {};

	constructor({ config, song }) {
		super();
		this.#song        = song;
		this.#maxGain     = config.maxGain;
		this.#resolution  = config.resolution;
		this.#emptyStroke = config.emptyStroke;

		if (navigator.audioSession) navigator.audioSession.type = 'playback';

		this.#defaultPreferences = config.defaultPreferences;
		this.#preferences        = { ...config.defaultPreferences, ...JSON.parse(localStorage.preferences ?? '{}') };
		this.#applyPreferences();

		document.addEventListener('visibilitychange', () => this.#handleVisibilityChange());
		document.addEventListener('freeze',           () => this.#playing && this.#stopHiddenPlay());

		this.#worker           = new Worker(new URL('./audio_worker.js', import.meta.url));
		this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
		this.#worker.postMessage({ action: 'config', payload: { resolution: config.resolution } });
		this.#postSong();
		song.addEventListener('change', ({ detail }) => this.#songChanged(detail));

		this.#loadInstrumentsLibrary(config.instrumentsLibraryReady).catch(() => {});
		this.#sounds = this.#fetchInstrumentSounds();

		defer(() => this.#ensureAudio());
		defer(() => this.#preferences.hiddenPlayDuration && this.#ensureAudioStream());
	}

	restart() {
		this.#worker.postMessage({ action: 'restart' });
		this.dispatchEvent(new Event('restart'));
	}

	unlock() {
		this.#startAudio();
	}

	async preview(index, stroke) {
		await this.#startAudio();
		if (!this.#preferences.strokePreview || this.#playing || stroke <= this.#emptyStroke) return;
		const id = index / this.#resolution.track | 0;
		this.#playNote(this.#song.tracks[id].instrument, id, stroke);
	}

	get playing() {
		return this.#playing;
	}

	get preferences() {
		return { ...this.#preferences };
	}

	setPreferences(values) {
		this.#preferences = { ...this.#preferences, ...values };
		const changed = Object.entries(this.#defaultPreferences)
			.filter(([name, initial]) => this.#preferences[name] !== initial)
			.map(([name]) => [name, this.#preferences[name]]);
		if (changed.length) localStorage.preferences = JSON.stringify(Object.fromEntries(changed));
		else delete localStorage.preferences;
		this.#applyPreferences();
	}

	#applyPreferences() {
		this.#updatePans();
		if (!this.#preferences.hiddenPlayDuration) this.#releaseAudioStream();
		else if (this.#playing) this.#ensureAudioStream().play().catch(() => {});
	}

	#songChanged({ tempo, tracks, steps, volumes, order, reset }) {
		if (reset) this.#muteSchedulesNotes();
		volumes.forEach((id) => this.#updateGain(id));
		if (tracks.size) this.#updatePans();
		if (tempo || tracks.size || steps.size || order) this.#postSong();
	}

	#postSong() {
		const { tempo, tracks, sheet, activeTracks } = this.#song;
		this.#worker.postMessage({ action: 'song', payload: { tempo, tracks, sheet, activeTracks } });
	}

	async #loadInstrumentsLibrary(instrumentsLibraryReady) {
		const { instruments } = await instrumentsLibraryReady;
		this.#panByInstrument = Object.fromEntries(instruments.map(({ id, pan = 0 }) => [id, pan]));
		this.#updatePans();
	}

	#gainOf(id) {
		return this.#song.volumes[id] / this.#maxGain * Math.SQRT2;
	}

	#updateGain(id) {
		if (this.#gainNodes) this.#gainNodes[id].gain.value = this.#gainOf(id);
	}

	#updatePans() {
		this.#panNodes?.forEach((node, id) => {
			node.pan.value = this.#preferences.audio === 'mono' ? 0 : this.#panByInstrument[this.#song.tracks[id].instrument] ?? 0;
		});
	}

	#ensureAudio() {
		return this.#audioReady ??= this.#initAudio();
	}

	async #initAudio() {
		this.#audioContext = new AudioContext({ latencyHint: 'playback' });
		this.#audioContext.addEventListener('statechange', () => this.#handleAudioStateChange());

		this.#masterGain = new GainNode(this.#audioContext);
		this.#masterGain.connect(this.#audioContext.destination);

		const tracks = this.#song.tracks;
		this.#panNodes  = tracks.map(() => new StereoPannerNode(this.#audioContext));
		this.#updatePans();
		this.#gainNodes = tracks.map((_, id) => {
			const gainNode = new GainNode(this.#audioContext, { gain: this.#gainOf(id) });
			gainNode.connect(this.#panNodes[id]).connect(this.#masterGain);
			return gainNode;
		});

		await this.#decodeInstrumentSounds(await this.#sounds);
	}

	#ensureAudioStream() {
		return this.#audioStream ??= this.#createAudioStream();
	}

	#releaseAudioStream() {
		if (!this.#audioStream) return;
		URL.revokeObjectURL(this.#audioStream.src);
		this.#audioStream.removeAttribute('src');
		this.#audioStream.load();
		this.#audioStream = null;
	}

	#createAudioStream() {
		const sampleRate = 8000;
		const length     = sampleRate * 10;
		const buffer     = new ArrayBuffer(44 + length * 2);
		const view       = new DataView(buffer);
		const samples    = new Int16Array(buffer, 44);
		for (const [offset, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
			for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
		}
		view.setUint32(4, 36 + length * 2, true);
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		view.setUint32(40, length * 2, true);
		for (let i = 0; i < length; i++) samples[i] = Math.sin(2 * Math.PI * 20 * i / sampleRate) * 1000;
		const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
		return Object.assign(new window.Audio(url), { loop: true, volume: 0.001 });
	}

	async #fetchInstrumentSounds() {
		const response = await fetchFromCache(storage.instrumentsSoundsFile);
		const json = await response.json();
		return Object.entries(json).map(([id, sounds]) => [id, sounds.map(dataURIToBuffer)]);
	}

	async #decodeInstrumentSounds(sounds) {
		const entries = await Promise.all(
			sounds.map(async ([id, buffers]) => [
				id,
				await Promise.all(buffers.map(async (buffer) => toMono(await this.#audioContext.decodeAudioData(buffer)))),
			])
		);
		this.#instruments = Object.fromEntries(entries);
	}

	#handleWorkerMessage({ action, payload }) {
		if (action === 'ticks') this.#playTicks(payload);
		else if (action === 'stop') this.#stopAudio();
	}

	async play() {
		await this.#startAudio();
		if (this.#preferences.hiddenPlayDuration) this.#ensureAudioStream().play().catch(() => {});
		this.#worker.postMessage({ action: 'start', payload: this.#audioContext.currentTime });
		this.#playing = true;
		this.dispatchEvent(new Event('play'));
		this.#handleVisibilityChange();
	}

	#startAudio() {
		this.#ensureAudio();
		return this.#audioContext.state !== 'running'
			? this.#audioContext.resume()
			: Promise.resolve();
	}

	stop() {
		if (!this.#audioContext) return;
		this.#worker.postMessage({ action: 'stop' });
		this.#muteSchedulesNotes();
		this.#stopAudio();
	}

	#stopAudio() {
		this.#playing = false;
		clearTimeout(this.#hiddenTimer);
		this.#hiddenTimer = null;
		this.#wakeLockRelease();
		if (this.#audioStream) {
			this.#audioStream.pause();
			this.#audioStream.currentTime = 0;
		}
		this.dispatchEvent(new Event('stop'));
	}

	#playTicks(ticks) {
		if (!this.#playing) return;
		const animations = new Map();
		const timeDelta = this.#audibleTimeDelta();

		for (let i = 0; i < ticks.length; i += 5) {
			const time       = ticks[i];
			const stroke     = ticks[i + 1];
			const instrument = ticks[i + 2];
			const trackIndex = ticks[i + 3];
			const stepIndex  = ticks[i + 4];
			if (stroke > this.#emptyStroke) {
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
		this.dispatchEvent(new CustomEvent('animations', { detail: { animations } }));
	}

	#audibleTimeDelta() {
		const { contextTime, performanceTime } = this.#audioContext.getOutputTimestamp();
		if (performanceTime > 0) return performanceTime - contextTime * 1000;
		const { currentTime, baseLatency = 0, outputLatency = 0 } = this.#audioContext;
		return performance.now() - (currentTime - baseLatency - outputLatency) * 1000;
	}

	#handleVisibilityChange() {
		clearTimeout(this.#hiddenTimer);
		this.#hiddenTimer = null;
		if (!this.#playing) return;

		if (document.hidden) this.#hiddenTimer = setTimeout(() => this.#stopHiddenPlay(), this.#preferences.hiddenPlayDuration * 1000);
		else this.#wakeLockRequest();
	}

	#stopHiddenPlay() {
		this.stop();
		this.#audioContext.suspend();
	}

	#handleAudioStateChange() {
		if (this.#audioContext.state !== 'running' && this.#hiddenTimer !== null) {
			this.stop();
		}
	}

	#playNote(instrument, gainIndex, stroke, time = this.#audioContext.currentTime) {
		const buffers = this.#instruments[instrument] || this.#instruments[0];
		if (!buffers) return;
		const buffer = buffers[stroke - 1] || buffers[0];
		const detune = (Math.random() * 2 - 1) * Audio.#detuneRange;
		const sound  = new AudioBufferSourceNode(this.#audioContext, { buffer, detune });
		sound.connect(this.#gainNodes[gainIndex]);
		this.#activeSources.add(sound);
		sound.addEventListener('ended', () => this.#activeSources.delete(sound), { once: true });
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
		try {
			const wakeLock = await navigator.wakeLock.request();
			if (this.#playing && !document.hidden) this.#wakeLock = wakeLock;
			else wakeLock.release();
		} catch {}
	}

	#wakeLockRelease() {
		this.#wakeLock?.release().catch(() => {});
		this.#wakeLock = null;
	}
}