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

	const setSource   = (searchParams[setSearchParam] || '').split(trackFormatSeparator);
	const volSource   = (searchParams[volumeSearchParam] || '');
	const lastEncoded = Number(trashed !== null && previousOrder.indexOf(trashed) < setSource.length);
	const setLength   = setSource.length - lastEncoded;

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
	const { defaultSetValue, trackFormatSeparator, trackHeaderLength } = config;
	const emptyValue   = defaultSetValue.repeat(trackHeaderLength);
	const encodedParts = [];

	for (const id of order) {
		const track   = tracks?.[id] || emptyTrack(config, id);
		const encoded = encodeTrack(config, track, sheet);
		if (encoded === emptyValue) break;
		encodedParts.push(encoded);
	}

	return encodedParts.join(trackFormatSeparator);
}

function encodeTrack(config, track, sheet) {
	const {
		formatDigits: digits, trackFormatAllocation: allocation, trackHeaderLength,
		defaultSteps, defaultBeats, defaultBars, defaultPhrase,
	} = config;
	const strokes = readStrokes(config, track, sheet);
	const base    = Math.max(1, ...strokes) + 1;

	const params = {
		base:    base - 2,
		steps:   toCode(track.steps,  defaultSteps),
		beats:   toCode(track.beats,  defaultBeats),
		bars:    toCode(track.bars,   defaultBars),
		phrase:  toCode(track.phrase, defaultPhrase),
		reserve: 0,
	};
	const packed = BigInt(pack(params, allocation));

	return digits[track.instrument]
		+ toDigits(packed, digits).padStart(trackHeaderLength - 1, digits[0])
		+ encodeSheet(strokes, base, digits);
}

function readStrokes({ resolution: { bar, beat } }, track, sheet) {
	const strokes = [];
	if (sheet === null) return strokes;
	for (let barIndex = 0; barIndex < track.bars; barIndex++) {
		const barOffset = track.sheetIndex + (barIndex * bar);
		for (let beatIndex = 0; beatIndex < track.beats; beatIndex++) {
			const beatOffset = barOffset + (beatIndex * beat);
			for (let stepIndex = 0; stepIndex < track.steps; stepIndex++) {
				strokes.push(sheet[beatOffset + stepIndex]);
			}
		}
	}
	return strokes;
}

function encodeSheet(strokes, base, digits) {
	const bigBase = BigInt(base);
	let number = 0n;
	for (let index = strokes.length - 1; index >= 0; index--) {
		number = number * bigBase + BigInt(strokes[index]);
	}
	return toDigits(number, digits);
}

function toCode(value, defaultValue) {
	return value === defaultValue ? 0 : value;
}

function encodeVolumes(config, { volumes, order }) {
	const { formatDigits: digits, defaultVolume } = config;
	const parts = [];
	let last = -1;

	for (let i = 0; i < order.length; i++) {
		const encoded = digits[volumes[order[i]]];
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

function pack(values, allocation) {
	const keys = Object.keys(allocation);
	let packed = 0;
	for (let i = keys.length - 1; i >= 0; i--) {
		packed = packed * allocation[keys[i]] + values[keys[i]];
	}
	return packed;
}

function toDigits(number, digits) {
	const base = BigInt(digits.length);
	let result = '';
	while (number > 0n) {
		result = digits[Number(number % base)] + result;
		number /= base;
	}
	return result;
}