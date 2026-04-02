const allocation = {
	instrument: 15,
	phrase: 4,
	bars: 8,
	beats: 2,
	steps: 4,
};
const outputDigits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const outputBase   = outputDigits.length;
const config       = {};
const stateCache   = {
	tempo:   config.defaultTempo,
	title:   config.defaultTitleValue,
	order:   null,
	sheet:   null,
	tracks:  null,
	volumes: null,
};

const allocationKeys = Object.keys(allocation);
const reversedAllocationKeys = [...allocationKeys].reverse();

let params;
let url_map;

self.onmessage = ({ data }) => {
	const { action, payload } = data;
	switch (action) {
		case 'init':      init(payload); break;
		case 'reset':     resetState(); break;
		case 'cache':     updateCache(payload.values); break;
		case 'encode':    encodeUrl(payload); break;
		case 'decode':    decodeUrl(payload); break;
		case 'decodeAll': decodeAll(payload); break;
		case 'move':      moveTrack(payload); break;
	}
}

function init(payload) {
	setConfig(payload.values);
	if (config.hasToDecodeNow) {
		decodeUrl(payload);
	}
}

function setConfig(interfaceConfig) {
	Object.assign(config, interfaceConfig);
	config.defaultVolume = stringBaseConvert(config.defaultGain, 10, outputBase);
	Object.freeze(config);

	stateCache.order = config.defaultOrder;

	url_map = {
		tempo:   config.tempoSearchParam,
		title:   config.titleSearchParam,
		sheet:   config.setSearchParam,
		tracks:  config.setSearchParam,
		volumes: config.volumeSearchParam,
	};

	params = {
		[config.setSearchParam]: {
			defaultValue: config.defaultSetValue,
			encode: encodeSet,
			decode: decodeSet,
		},
		[config.volumeSearchParam]: {
			defaultValue: config.defaultVolume,
			encode: encodeVolumes,
			decode: decodeVolumes,
		},
		[config.tempoSearchParam]: {
			defaultValue: config.defaultTempo,
			encode: (defaultValue) => stateCache.tempo === defaultValue ? '' : `${stateCache.tempo}`,
			decode: (value, defaultValue, changes) => changes.tempo = value,
		},
		[config.titleSearchParam]: {
			defaultValue: config.defaultTitleValue,
			encode: () => stateCache.title,
			decode: (value, defaultValue, changes) => changes.title = value,
		},
	};
}

function encodeUrl({ values, searchParams }) {
	updateCache(values);
	let changed = false;
	const processedParams = new Set();
	for (const item in values) {
		const paramName = url_map[item];
		if (!paramName || processedParams.has(paramName)) continue;
		const { encode, defaultValue } = params[paramName];
		const encodedValue = encode(defaultValue) || null;
		const currentValue = searchParams[paramName] || null;
		if (encodedValue !== currentValue) {
			encodedValue ? (searchParams[paramName] = encodedValue) : delete searchParams[paramName];
			changed = true;
		}
		processedParams.add(paramName);
	}
	if (changed) {
		self.postMessage({ action: 'encoded', payload: searchParams });
	}
}

function decodeAll({ searchParams }) {
	const completeParams = {};
	for (const [param, { defaultValue }] of Object.entries(params)) {
		completeParams[param] = defaultValue;
	}
	Object.assign(completeParams, searchParams);
	decodeUrl({ searchParams: completeParams });
}

function decodeUrl({ searchParams }) {
	const changes = {}
	for (const [param, { defaultValue, decode }] of Object.entries(params)) {
		const value = searchParams[param];
		if (value !== undefined && value !== null) {
			decode(value, defaultValue, changes, searchParams);
		}
	}
	if (Object.keys(changes).length === 0) return;
	self.postMessage({ action: 'decoded',  payload: changes });
}

function encodeSet(defaultValue) {
	const { tracks, sheet, order } = stateCache;
	const encodedParts = [];
	const defaultHeader = defaultValue.repeat(2);
	for (const id of order) {
		const track = tracks?.[id] || emptyTrack(id);
		const header = encodeTrack(track, defaultValue);
		const body   = encodeSheet(track, sheet, defaultValue);
		if (header === defaultHeader && body === '') break; 
		encodedParts.push(header + body);
	}
	return encodedParts.join('-');
}

function encodeTrack(track, defaultValue) {
	const { stepsIndex, beatsIndex, barsIndex, phraseIndex, instrumentsIndex } = config;
	const { id: instrument } = instrumentsIndex[track.instrument];
	const packingValues = {
		steps:  stepsIndex .indexOf(track.steps),
		beats:  beatsIndex .indexOf(track.beats),
		bars:   barsIndex  .indexOf(track.bars),
		phrase: phraseIndex.indexOf(track.phrase),
		instrument,
	};
	return stringBaseConvert(pack(packingValues, allocation), 10, outputBase).padStart(2, defaultValue);
}

function encodeSheet(track, sheet, defaultValue) {
	if (sheet === null) return '';
	const { resolution: { bar, beat }, instrumentsIndex } = config;
	const { base: instrumentBase } = instrumentsIndex[track.instrument];

	let sheetArray = [];
	for (let barIndex = track.bars - 1; barIndex >= 0; barIndex--) {
		const barOffset = track.sheetIndex + (barIndex * bar);
		for (let beatIndex = track.beats - 1; beatIndex >= 0; beatIndex--) {
			const beatOffset = barOffset + (beatIndex * beat);
			sheetArray.push([...sheet.subarray(beatOffset, beatOffset + track.steps)].reverse().join(''));
		}
	}
	const encoded = stringBaseConvert(sheetArray.join(''), instrumentBase, outputBase);
	return encoded === defaultValue ? '' : encoded;
}

function decodeSet(encodedValues, defaultValue, changes) {
	const sheetChanges = [];
	const tracksChanges = [];
	const values = encodedValues.split('-');
	const isVirginTrack = !stateCache.tracks; 
	const isVirginSheet = !stateCache.sheet; 
	const {
		barsIndex, beatsIndex, stepsIndex, phraseIndex, instrumentsIndex,
		tracksLength, defaultBars, defaultBeats, defaultSteps, defaultPhrase,
		defaultInstrument, resolution: { maxBars, maxBeats, bar, beat }
	} = config;

	const limitTracks = isVirginTrack ? values.length : tracksLength;
	for (let i = 0; i < limitTracks; i++) {
		const trackChanges = {};
		const id = stateCache.order[i];
		const track = stateCache.tracks?.[id] || emptyTrack(id);
		const data = (values[i] || '').padEnd(3, defaultValue);

		const packed = parseInt(stringBaseConvert(data.slice(0, 2), outputBase, 10));
		const paramsValues = unpack(packed, allocation);

		let instrument = instrumentsIndex.findIndex(inst => inst.id === paramsValues.instrument);
		if (instrument === -1) instrument = defaultInstrument;

		const params = {
			bars:       barsIndex[paramsValues.bars]      ?? defaultBars,
			beats:      beatsIndex[paramsValues.beats]    ?? defaultBeats,
			steps:      stepsIndex[paramsValues.steps]    ?? defaultSteps,
			phrase:     phraseIndex[paramsValues.phrase]  ?? defaultPhrase,
			instrument,
		};

		for (const key in params) {
			if (track[key] !== params[key]) {
				trackChanges[key] = params[key];
			}
		}

		const instrumentBase = instrumentsIndex[instrument].base;
		const sheetString = stringBaseConvert(data.slice(2), outputBase, instrumentBase);
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

					const currentValue = stateCache.sheet?.[bufferIndex] ?? 0;

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

function encodeVolumes(defaultValue) {
	const { volumes } = stateCache;
	const parts = [];
	let last = -1;
	for (let i = 0; i < stateCache.order.length; i++) {
		const id = stateCache.order[i];
		const encoded = stringBaseConvert(volumes[id], 10, outputBase);
		parts.push(encoded);
		if (encoded !== defaultValue) {
			last = i;
		}
	}

	if (last === -1) return '';
	return parts.slice(0, last + 1).join('');
}

function decodeVolumes(encodedValues, defaultValue, changes) {
	const volumesChanges = [];
	for (let index = 0; index < config.tracksLength; index++) {
		const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultValue;
		const value = Number(stringBaseConvert(encodeVolume, outputBase, 10));
		const id = stateCache.order[index];
		const currentValue = stateCache.volumes?.[id] ?? config.defaultGain;
		if (value !== currentValue) {
			volumesChanges.push({ id, value });
		}
	}
	if (volumesChanges.length > 0) {
		changes.volumes = volumesChanges;
	}
}

function moveTrack(payload) {
	const { values: { trashed, order }, searchParams } = payload;
	const { order: oldOrder } = stateCache;

	const setSource = (searchParams[config.setSearchParam] || '').split('-');
	const volSource = (searchParams[config.volumeSearchParam] || '');
	const setLength = trashed !== null ? setSource.length - 1 : setSource.length;

	const newSetArray  = new Array(setLength);
	const newVolArray  = new Array(setLength);

	let lastVolIndex = -1;

	for (let i = 0; i < setLength; i++) {
		const id = order[i];
		const oldIndex = oldOrder.indexOf(id);
		const isTrashed = id === trashed;
		newSetArray[i] = isTrashed ? '' : (setSource[oldIndex] || '');
		newVolArray[i] = isTrashed ? config.defaultVolume : (volSource[oldIndex] || config.defaultVolume);
		if (newVolArray[i] !== config.defaultVolume) lastVolIndex = i;
	}
	const newSet = newSetArray.join('-');
	const newVol = lastVolIndex === -1 ? '' : newVolArray.slice(0, lastVolIndex + 1).join('');

	if (newSet) searchParams[config.setSearchParam] = newSet;
	else delete searchParams[config.setSearchParam];

	if (newVol) searchParams[config.volumeSearchParam] = newVol;
	else delete searchParams[config.volumeSearchParam];

	stateCache.order = order;
	self.postMessage({ action: 'encoded', payload: searchParams });
}

function updateCache(values) {
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== null) {
			stateCache[key] = value;
		}
	}
}

function resetState() {
	stateCache.tempo   = config.defaultTempo;
	stateCache.title   = config.defaultTitleValue;
	stateCache.sheet   = null;
	stateCache.tracks  = null; 
	stateCache.volumes = null;
}

function emptyTrack(index) {
	return {
		bars:       config.defaultBars,
		beats:      config.defaultBeats,
		steps:      config.defaultSteps,
		phrase:     config.defaultPhrase,
		instrument: config.defaultInstrument,
		sheetIndex: config.resolution.track * index,
	};
}

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

function pack(values, bases) {
	return reversedAllocationKeys.reduce((acc, key) => acc * bases[key] + values[key], 0);
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