const allocation = {
	phrase:   6,
	bars:     8,
	beats:    4,
	steps:    5,
	reserved: 4,
};

const outputDigits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const outputBase   = outputDigits.length;

const allocationKeys = Object.keys(allocation);

function stringBaseConvert(string, fromBase, base) {
	base     = BigInt(base);
	fromBase = BigInt(fromBase);
	string   = string.toString();

	let number = 0n;
	for (let i = 0; i < string.length; i++) {
		number = number * fromBase + BigInt(outputDigits.indexOf(string[i]));
	}

	if (number === 0n) return '0';

	let result = '';
	while (number > 0n) {
		result = outputDigits[Number(number % base)] + result;
		number /= base;
	}
	return result;
}

function unpack(value, bases) {
	const result = {};
	for (const key of allocationKeys) {
		const base = bases[key];
		result[key] = value % base;
		value = (value / base) | 0;
	}
	return result;
}

export class Navigation {
	#bus;
	#worker = null;
	#config;
	#params;
	#searchParams;
	#setSearchParam;
	#defaultSetValue;
	#titleSearchParam;
	#tempoSearchParam;
	#volumeSearchParam;
	#updateSearchParam;
	#defaultTitleValue;

	#state = {
		tempo:   null,
		title:   null,
		order:   null,
		sheet:   null,
		tracks:  null,
		volumes: null,
	};

	constructor({ bus, config }) {
		this.#bus               = bus;
		this.#searchParams      = new URLSearchParams(location.search);
		this.#setSearchParam    = config.setSearchParam;
		this.#titleSearchParam  = config.titleSearchParam;
		this.#tempoSearchParam  = config.tempoSearchParam;
		this.#volumeSearchParam = config.volumeSearchParam;
		this.#updateSearchParam = config.updateSearchParam;
		this.#defaultSetValue   = config.defaultSetValue;
		this.#defaultTitleValue = config.defaultTitleValue;

		this.#cleanUpdateSearchParam();

		history.scrollRestoration = 'manual';

		this.#init(config);
		this.#scheduleWorker();

		const navigationReady = window.navigation ? Promise.resolve() : import('./polyfills/navigation.js');
		navigationReady.then(() => navigation.addEventListener('navigate', event => this.#handleNavigation(event)));

		this.#bus.addEventListener('audio:state',            ({ detail }) => this.#updateState(detail));
		this.#bus.addEventListener('audio:changed',          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener('presets:changed',        ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener('presets:presetSelected', ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener('interface:reset',        ({ detail }) => this.#reset());
		this.#bus.addEventListener('interface:moveTrack',    ({ detail }) => this.#moveTrack(detail));
		this.#bus.addEventListener('sw-client:install',      () => this.#reload());
	}

	#init(config) {
		this.#config = Object.freeze({
			allocation,
			outputDigits,
			resolution:        config.resolution,
			emptyStroke:       config.emptyStroke,
			tracksLength:      config.tracksLength,
			tempoStep:         config.tempoStep,
			defaultGain:       config.defaultGain,
			defaultBars:       config.defaultBars,
			defaultBeats:      config.defaultBeats,
			defaultSteps:      config.defaultSteps,
			defaultTempo:      config.defaultTempo,
			defaultOrder:      config.defaultOrder,
			defaultPhrase:     config.defaultPhrase,
			defaultSetValue:   config.defaultSetValue,
			defaultTitleValue: config.defaultTitleValue,
			defaultInstrument: config.defaultInstrument,
			defaultVolume:     stringBaseConvert(config.defaultGain, 10, outputBase),
			setSearchParam:    config.setSearchParam,
			tempoSearchParam:  config.tempoSearchParam,
			titleSearchParam:  config.titleSearchParam,
			volumeSearchParam: config.volumeSearchParam,
			barsIndex:         [config.defaultBars,   ...config.barsValues  .filter(value => value !== config.defaultBars)],
			beatsIndex:        [config.defaultBeats,  ...config.beatsValues .filter(value => value !== config.defaultBeats)],
			stepsIndex:        [config.defaultSteps,  ...config.stepsValues .filter(value => value !== config.defaultSteps)],
			phraseIndex:       [config.defaultPhrase, ...config.phraseValues.filter(value => value !== config.defaultPhrase)],
			instrumentsBase:   Object.fromEntries(config.instrumentsLibrary.instruments.map(({ id, strokes }) => [id, strokes.length + 1])),
		});

		this.#state.order = this.#config.defaultOrder;
		this.#state.tempo = this.#config.defaultTempo;
		this.#state.title = this.#config.defaultTitleValue;

		this.#params = {
			[this.#config.setSearchParam]: {
				defaultValue: this.#config.defaultSetValue,
				decode: (value, defaultValue, changes) => this.#decodeSet(value, defaultValue, changes),
			},
			[this.#config.volumeSearchParam]: {
				defaultValue: this.#config.defaultVolume,
				decode: (value, defaultValue, changes) => this.#decodeVolumes(value, defaultValue, changes),
			},
			[this.#config.tempoSearchParam]: {
				defaultValue: this.#config.defaultTempo,
				decode: (value, defaultValue, changes) => changes.tempo = value,
			},
			[this.#config.titleSearchParam]: {
				defaultValue: this.#config.defaultTitleValue,
				decode: (value, defaultValue, changes) => changes.title = value,
			},
		};

		if (this.#searchParams.size > 0) {
			const changes = this.#decodeUrl(this.#searchAsObject());
			if (changes) queueMicrotask(() => this.#dispatchDecoded(changes));
		}
	}

	#scheduleWorker() {
		const create = () => this.#encoder;
		if ('requestIdleCallback' in window) requestIdleCallback(create, { timeout: 3000 });
		else setTimeout(create, 500);
	}

	get #encoder() {
		return this.#worker ??= this.#createWorker();
	}

	#createWorker() {
		const worker = new Worker(new URL('./navigation_worker.js', import.meta.url));
		worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
		worker.postMessage({ action: 'init', payload: { config: this.#config } });
		return worker;
	}

	#decodeUrl(searchParams) {
		const changes = {};
		for (const [param, { defaultValue, decode }] of Object.entries(this.#params)) {
			const value = searchParams[param];
			if (value !== undefined && value !== null) {
				decode(value, defaultValue, changes, searchParams);
			}
		}
		return Object.keys(changes).length === 0 ? null : changes;
	}

	#decodeAll(searchParams) {
		const completeParams = {};
		for (const [param, { defaultValue }] of Object.entries(this.#params)) {
			completeParams[param] = defaultValue;
		}
		Object.assign(completeParams, searchParams);
		return this.#decodeUrl(completeParams);
	}

	#decodeSet(encodedValues, defaultValue, changes) {
		const sheetChanges = [];
		const tracksChanges = [];
		const values = encodedValues.split('-');
		const isVirginTrack = !this.#state.tracks;
		const isVirginSheet = !this.#state.sheet;
		const {
			barsIndex, beatsIndex, stepsIndex, phraseIndex, tracksLength,
			defaultBars, defaultBeats, defaultSteps, defaultPhrase,
			resolution: { maxBars, maxBeats, bar, beat }
		} = this.#config;

		const limitTracks = isVirginTrack ? values.length : tracksLength;
		for (let i = 0; i < limitTracks; i++) {
			const trackChanges = {};
			const id = this.#state.order[i];
			const track = this.#state.tracks?.[id] || this.#emptyTrack(id);
			const data = (values[i] || '').padEnd(3, defaultValue);

			const instrument   = +stringBaseConvert(data.slice(0, 1), outputBase, 10);
			const base         = Math.min(+stringBaseConvert(data.slice(1, 2), outputBase, 10) + 2, 10);
			const packedValues = +stringBaseConvert(data.slice(2, 4), outputBase, 10);
			const paramsValues = unpack(packedValues, allocation);

			const params = {
				bars:       barsIndex[paramsValues.bars]     ?? defaultBars,
				beats:      beatsIndex[paramsValues.beats]   ?? defaultBeats,
				steps:      stepsIndex[paramsValues.steps]   ?? defaultSteps,
				phrase:     phraseIndex[paramsValues.phrase] ?? defaultPhrase,
				instrument,
			};

			for (const key in params) {
				if (track[key] !== params[key]) {
					trackChanges[key] = params[key];
				}
			}

			const sheetString = stringBaseConvert(data.slice(4), outputBase, base);
			const limitBars  = isVirginTrack ? params.bars  : maxBars;
			const limitBeats = isVirginTrack ? params.beats : maxBeats;
			const limitSteps = isVirginTrack ? params.steps : beat;
			let charPointer = sheetString.length - 1;

			loop:
			for (let barIndex = 0; barIndex < limitBars; barIndex++) {
				const barOffset = track.sheetIndex + (barIndex * bar);
				const isBarActive = barIndex < params.bars;

				for (let beatIndex = 0; beatIndex < limitBeats; beatIndex++) {
					const beatOffset = barOffset + (beatIndex * beat);
					const isBeatActive = isBarActive && beatIndex < params.beats;

					for (let stepIndex = 0; stepIndex < limitSteps; stepIndex++) {
						if (isVirginSheet && charPointer < 0) break loop;

						const bufferIndex = beatOffset + stepIndex;

						const value = (isBeatActive && stepIndex < params.steps && charPointer >= 0)
							? Number(sheetString[charPointer--])
							: 0;

						const currentValue = this.#state.sheet?.[bufferIndex] ?? 0;

						if (value !== currentValue) {
							sheetChanges.push({ stepIndex: bufferIndex, value });
						}
					}
				}
			}

			if (Object.keys(trackChanges).length) {
				tracksChanges.push({ id, changes: trackChanges });
			}
		}

		if (sheetChanges.length) changes.sheet = sheetChanges;
		if (tracksChanges.length) changes.tracks = tracksChanges;
	}

	#decodeVolumes(encodedValues, defaultValue, changes) {
		const volumesChanges = [];
		for (let index = 0; index < this.#config.tracksLength; index++) {
			const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultValue;
			const value = Number(stringBaseConvert(encodeVolume, outputBase, 10));
			const id = this.#state.order[index];
			const currentValue = this.#state.volumes?.[id] ?? this.#config.defaultGain;
			if (value !== currentValue) {
				volumesChanges.push({ id, value });
			}
		}
		if (volumesChanges.length > 0) {
			changes.volumes = volumesChanges;
		}
	}

	#emptyTrack(index) {
		const { defaultBars, defaultBeats, defaultSteps, defaultPhrase, defaultInstrument, resolution } = this.#config;
		return {
			bars:       defaultBars,
			beats:      defaultBeats,
			steps:      defaultSteps,
			phrase:     defaultPhrase,
			instrument: defaultInstrument,
			sheetIndex: resolution.track * index,
		};
	}

	#updateState(values) {
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined && value !== null) {
				this.#state[key] = value;
			}
		}
	}

	#resetState() {
		this.#state.tempo   = this.#config.defaultTempo;
		this.#state.title   = this.#config.defaultTitleValue;
		this.#state.sheet   = null;
		this.#state.tracks  = null;
		this.#state.volumes = null;
	}

	#dispatchDecoded(changes) {
		this.#bus.dispatchEvent(new CustomEvent('navigation:decoded', { detail: changes }));
	}

	#cleanUpdateSearchParam() {
		if (this.#searchParams.has(this.#updateSearchParam)) {
			this.#searchParams.delete(this.#updateSearchParam);
			history.replaceState(null, '', this.#url);
		}
	}

	#reload() {
		const url = new URL(location.pathname, location.origin);
		url.searchParams.set(this.#updateSearchParam, Date.now());
		location.replace(url);
	}

	#handleWorkerMessage({ action, payload }) {
		if (action !== 'encoded') return;
		this.#searchParams = new URLSearchParams(payload);
		window.navigation.navigate(this.#url, {
			history: 'replace',
			state: { action: 'encoded', dispatch: true }
		});
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const state = destination.getState() || {};

		if (navigationType === 'traverse') {
			const modal = { closed: false };
			this.#bus.dispatchEvent(new CustomEvent('navigation:closeModal', { detail: modal }));
			if (modal.closed) {
				event.preventDefault();
				return;
			}
		}

		if (url.searchParams.has(this.#updateSearchParam) || 
			url.protocol === 'blob:' || 
			!canIntercept || 
			hashChange || 
			downloadRequest) return;

		const isTraverse = navigationType === 'traverse';
		const action = isTraverse ? 'decodeAll' : state.action;
		const shouldDispatch = isTraverse || !!state.dispatch;

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: async () => {
				this.#searchParams = url.searchParams;
				if (['reset', 'decode', 'decodeAll'].includes(action)) {
					window.scrollTo(0, 0);
					this.#decodeAction(action);
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent('navigation:changed', {
						detail: new Map(this.#searchParams) 
					}));
				}
			}
		});
	}

	#decodeAction(action) {
		if (action === 'reset') {
			this.#resetState();
			return;
		}
		const searchParams = this.#searchAsObject();
		const changes = action === 'decodeAll'
			? this.#decodeAll(searchParams)
			: this.#decodeUrl(searchParams);
		if (changes) this.#dispatchDecoded(changes);
	}

	#presetSelected({ name, value }) {
		this.#searchParams.set(this.#setSearchParam, value || this.#defaultSetValue);
		this.#searchParams.set(this.#titleSearchParam, name || this.#defaultTitleValue);
		navigation.navigate(this.#url, { 
			state: { action: 'decode', dispatch: true }
		});
	}

	#encodeURL(values) {
		this.#updateState(values);
		queueMicrotask(() => this.#postMessage('encode', values));
	}

	#moveTrack(moved) {
		const previousOrder = this.#state.order;
		this.#state.order = moved.order;
		queueMicrotask(() => this.#postMessage('move', { ...moved, previousOrder }));
	}

	#reset() {
		const oldSearch = this.#searchParams.toString();
		this.#searchParams.delete(this.#setSearchParam);
		this.#searchParams.delete(this.#titleSearchParam);
		this.#searchParams.delete(this.#tempoSearchParam);
		this.#searchParams.delete(this.#volumeSearchParam);
		const newSearch = this.#searchParams.toString();
		if (newSearch === oldSearch) return;

		navigation.navigate(this.#url, {
			state: { action: 'reset', dispatch: false } 
		});
	}

	#postMessage(action, values) {
		this.#encoder.postMessage({
			action,
			payload: {
				searchParams: this.#searchAsObject(),
				state: this.#state,
				values,
			},
		});
	}

	#searchAsObject() {
		return Object.fromEntries(this.#searchParams.entries());
	}

	get #url() {
		return this.#searchParams.size > 0
			? `?${this.#searchParams.toString()}`
			: '.';
	}

}
