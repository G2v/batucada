export function encodeUrl(config, { values, state, searchParams }) {
	const { setSearchParam, volumeSearchParam, tempoSearchParam, titleSearchParam } = config;

	const urlMap = {
		tempo:   tempoSearchParam,
		title:   titleSearchParam,
		sheet:   setSearchParam,
		tracks:  setSearchParam,
		volumes: volumeSearchParam,
	};

	const encoders = {
		[setSearchParam]:    () => encodeSet(config, state),
		[volumeSearchParam]: () => encodeVolumes(config, state),
		[tempoSearchParam]:  () => state.tempo === config.defaultTempo ? '' : `${state.tempo}`,
		[titleSearchParam]:  () => state.title,
	};

	let changed = false;
	const processedParams = new Set();

	for (const item in values) {
		const paramName = urlMap[item];
		if (!paramName || processedParams.has(paramName)) continue;
		const encodedValue = encoders[paramName]() || null;
		const currentValue = searchParams[paramName] || null;
		if (encodedValue !== currentValue) {
			encodedValue ? (searchParams[paramName] = encodedValue) : delete searchParams[paramName];
			changed = true;
		}
		processedParams.add(paramName);
	}

	return changed ? searchParams : null;
}

export function moveTrack(config, { values: { trashed, order, previousOrder }, searchParams }) {
	const { setSearchParam, volumeSearchParam, defaultVolume, trackFormatSeparator } = config;

	const setSource = (searchParams[setSearchParam] || '').split(trackFormatSeparator);
	const volSource = (searchParams[volumeSearchParam] || '');
	const setLength = trashed !== null ? setSource.length - 1 : setSource.length;

	const newSetArray = new Array(setLength);
	const newVolArray = new Array(setLength);
	let lastVolIndex  = -1;

	for (let i = 0; i < setLength; i++) {
		const id        = order[i];
		const oldIndex  = previousOrder.indexOf(id);
		const isTrashed = id === trashed;
		newSetArray[i] = isTrashed ? '' : (setSource[oldIndex] || '');
		newVolArray[i] = isTrashed ? defaultVolume : (volSource[oldIndex] || defaultVolume);
		if (newVolArray[i] !== defaultVolume) lastVolIndex = i;
	}

	const newSet = newSetArray.join(trackFormatSeparator);
	const newVol = lastVolIndex === -1 ? '' : newVolArray.slice(0, lastVolIndex + 1).join('');

	if (newSet) searchParams[setSearchParam] = newSet;
	else delete searchParams[setSearchParam];

	if (newVol) searchParams[volumeSearchParam] = newVol;
	else delete searchParams[volumeSearchParam];

	return searchParams;
}

function encodeSet(config, { tracks, sheet, order }) {
	const { defaultSetValue, trackFormatSeparator } = config;
	const defaultHeader = defaultSetValue.repeat(4);
	const encodedParts  = [];

	for (const id of order) {
		const track  = tracks?.[id] || emptyTrack(config, id);
		const header = encodeTrack(config, track);
		const body   = encodeSheet(config, track, sheet);
		if (header === defaultHeader && body === '') break;
		encodedParts.push(header + body);
	}

	return encodedParts.join(trackFormatSeparator);
}

function encodeTrack(config, track) {
	const {
		formatDigits: digits, trackFormatAllocation: allocation, defaultSetValue,
		stepsIndex, beatsIndex, barsIndex, phraseIndex, instrumentsBase,
	} = config;
	const outputBase = digits.length;

	const baseValue  = (instrumentsBase[track.instrument] ?? 2) - 2;
	const base       = stringBaseConvert(baseValue, 10, outputBase, digits);
	const instrument = stringBaseConvert(track.instrument, 10, outputBase, digits);

	const params = {
		steps:    stepsIndex .indexOf(track.steps),
		beats:    beatsIndex .indexOf(track.beats),
		bars:     barsIndex  .indexOf(track.bars),
		phrase:   phraseIndex.indexOf(track.phrase),
		reserved: 0,
	};
	const packedParams = stringBaseConvert(pack(params, allocation), 10, outputBase, digits)
		.padStart(2, defaultSetValue);

	return instrument + base + packedParams;
}

function encodeSheet(config, track, sheet) {
	if (sheet === null) return '';
	const { formatDigits: digits, defaultSetValue, instrumentsBase, resolution: { bar, beat } } = config;
	const outputBase = digits.length;
	const base       = instrumentsBase[track.instrument] || 2;

	const sheetArray = [];
	for (let barIndex = track.bars - 1; barIndex >= 0; barIndex--) {
		const barOffset = track.sheetIndex + (barIndex * bar);
		for (let beatIndex = track.beats - 1; beatIndex >= 0; beatIndex--) {
			const beatOffset = barOffset + (beatIndex * beat);
			sheetArray.push([...sheet.subarray(beatOffset, beatOffset + track.steps)].reverse().join(''));
		}
	}

	const encoded = stringBaseConvert(sheetArray.join(''), base, outputBase, digits);
	return encoded === defaultSetValue ? '' : encoded;
}

function encodeVolumes(config, { volumes, order }) {
	const { formatDigits: digits, defaultVolume } = config;
	const outputBase = digits.length;
	const parts = [];
	let last = -1;

	for (let i = 0; i < order.length; i++) {
		const encoded = stringBaseConvert(volumes[order[i]], 10, outputBase, digits);
		parts.push(encoded);
		if (encoded !== defaultVolume) last = i;
	}

	if (last === -1) return '';
	return parts.slice(0, last + 1).join('');
}

function emptyTrack(config, index) {
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

export function pack(values, allocation) {
	const keys = Object.keys(allocation);
	let packed = 0;
	for (let i = keys.length - 1; i >= 0; i--) {
		packed = packed * allocation[keys[i]] + values[keys[i]];
	}
	return packed;
}

export function stringBaseConvert(string, fromBase, base, digits) {
	base     = BigInt(base);
	fromBase = BigInt(fromBase);
	string   = string.toString();

	let number = 0n;
	for (let i = 0; i < string.length; i++) {
		number = number * fromBase + BigInt(digits.indexOf(string[i]));
	}

	if (number === 0n) return '0';

	let result = '';
	while (number > 0n) {
		result = digits[Number(number % base)] + result;
		number /= base;
	}
	return result;
}