let config;
let url_map;
let allocationKeys;
let outputDigits;
let outputBase;

self.onmessage = ({ data }) => {
	const { action, payload } = data;

	if (action === 'init') {
		setConfig(payload.config);
		return;
	}

	const searchParams = action === 'encode' ? encodeUrl(payload)
	                   : action === 'move'   ? moveTrack(payload)
	                   : null;

	if (searchParams) self.postMessage({ action: 'encoded', payload: searchParams });
}

function setConfig(interfaceConfig) {
	config = interfaceConfig;
	outputDigits = config.outputDigits;
	outputBase = outputDigits.length;
	allocationKeys = [...Object.keys(config.allocation)].reverse();

	url_map = {
		tempo:   config.tempoSearchParam,
		title:   config.titleSearchParam,
		sheet:   config.setSearchParam,
		tracks:  config.setSearchParam,
		volumes: config.volumeSearchParam,
	};
}

function encodeUrl({ values, state, searchParams }) {
	const encoders = {
		[config.setSearchParam]:    { defaultValue: config.defaultSetValue,   encode: () => encodeSet(state, config.defaultSetValue) },
		[config.volumeSearchParam]: { defaultValue: config.defaultVolume,     encode: () => encodeVolumes(state, config.defaultVolume) },
		[config.tempoSearchParam]:  { defaultValue: config.defaultTempo,      encode: () => state.tempo === config.defaultTempo ? '' : `${state.tempo}` },
		[config.titleSearchParam]:  { defaultValue: config.defaultTitleValue, encode: () => state.title },
	};

	let changed = false;
	const processedParams = new Set();

	for (const item in values) {
		const paramName = url_map[item];
		if (!paramName || processedParams.has(paramName)) continue;
		const encodedValue = encoders[paramName].encode() || null;
		const currentValue = searchParams[paramName] || null;
		if (encodedValue !== currentValue) {
			encodedValue ? (searchParams[paramName] = encodedValue) : delete searchParams[paramName];
			changed = true;
		}
		processedParams.add(paramName);
	}

	return changed ? searchParams : null;
}

function encodeSet({ tracks, sheet, order }, defaultValue) {
	const encodedParts = [];
	const defaultHeader = defaultValue.repeat(4);
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
	const { stepsIndex, beatsIndex, barsIndex, phraseIndex, instrumentsBase, allocation } = config;
	const baseValue  = (instrumentsBase[track.instrument] ?? 2) - 2;
	const base = stringBaseConvert(baseValue, 10, outputBase);
	const instrument = stringBaseConvert(track.instrument, 10, outputBase);
	const params = {
		steps:    stepsIndex .indexOf(track.steps),
		beats:    beatsIndex .indexOf(track.beats),
		bars:     barsIndex  .indexOf(track.bars),
		phrase:   phraseIndex.indexOf(track.phrase),
		reserved: 0,
	};
	const packedParams = stringBaseConvert(pack(params, allocation), 10, outputBase).padStart(2, defaultValue);
	return instrument + base + packedParams;
}

function encodeSheet(track, sheet, defaultValue) {
	if (sheet === null) return '';
	const { resolution: { bar, beat }, instrumentsBase } = config;
	const base = instrumentsBase[track.instrument] || 2;

	let sheetArray = [];
	for (let barIndex = track.bars - 1; barIndex >= 0; barIndex--) {
		const barOffset = track.sheetIndex + (barIndex * bar);
		for (let beatIndex = track.beats - 1; beatIndex >= 0; beatIndex--) {
			const beatOffset = barOffset + (beatIndex * beat);
			sheetArray.push([...sheet.subarray(beatOffset, beatOffset + track.steps)].reverse().join(''));
		}
	}
	const encoded = stringBaseConvert(sheetArray.join(''), base, outputBase);
	return encoded === defaultValue ? '' : encoded;
}

function encodeVolumes({ volumes, order }, defaultValue) {
	const parts = [];
	let last = -1;
	for (let i = 0; i < order.length; i++) {
		const encoded = stringBaseConvert(volumes[order[i]], 10, outputBase);
		parts.push(encoded);
		if (encoded !== defaultValue) {
			last = i;
		}
	}

	if (last === -1) return '';
	return parts.slice(0, last + 1).join('');
}

function moveTrack({ values: { trashed, order, previousOrder }, searchParams }) {
	const setSource = (searchParams[config.setSearchParam] || '').split('-');
	const volSource = (searchParams[config.volumeSearchParam] || '');
	const setLength = trashed !== null ? setSource.length - 1 : setSource.length;

	const newSetArray  = new Array(setLength);
	const newVolArray  = new Array(setLength);

	let lastVolIndex = -1;

	for (let i = 0; i < setLength; i++) {
		const id = order[i];
		const oldIndex = previousOrder.indexOf(id);
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

	return searchParams;
}

function emptyTrack(index) {
	const { defaultBars, defaultBeats, defaultSteps, defaultPhrase, defaultInstrument, resolution } = config;
	return {
		bars:       defaultBars,
		beats:      defaultBeats,
		steps:      defaultSteps,
		phrase:     defaultPhrase,
		instrument: defaultInstrument,
		sheetIndex: resolution.track * index,
	};
}

function pack(values, bases) {
	return allocationKeys.reduce((acc, key) => acc * bases[key] + values[key], 0);
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
