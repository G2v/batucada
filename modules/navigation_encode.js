export function encodeUrl(config, { values, song, searchParams }) {
	const { setSearchParam, volumeSearchParam, tempoSearchParam, titleSearchParam } = config;

	const urlMap = {
		tempo:   tempoSearchParam,
		title:   titleSearchParam,
		sheet:   setSearchParam,
		tracks:  setSearchParam,
		volumes: volumeSearchParam,
	};

	const encoders = {
		[setSearchParam]:    () => encodeSet(config, song),
		[volumeSearchParam]: () => encodeVolumes(config, song),
		[tempoSearchParam]:  () => song.tempo === config.defaultTempo ? '' : `${song.tempo}`,
		[titleSearchParam]:  () => song.title,
	};

	const params = new URLSearchParams(searchParams);
	let changed  = false;
	for (const name of new Set(Object.keys(values).map(item => urlMap[item]).filter(Boolean))) {
		const encoded = encoders[name]() || null;
		if (encoded === (params.get(name) || null)) continue;
		if (encoded) params.set(name, encoded);
		else params.delete(name);
		changed = true;
	}
	return changed ? params : null;
}

function encodeSet(config, { tracks, sheet, order }) {
	const { defaultSetValue, trackFormatSeparator, trackHeaderLength } = config;
	const emptyValue   = defaultSetValue.repeat(trackHeaderLength);
	const encodedParts = [];

	for (const id of order) {
		const start   = id * config.resolution.track;
		const encoded = encodeTrack(config, tracks[id], sheet.subarray(start, start + config.resolution.track));
		if (encoded === emptyValue) break;
		encodedParts.push(encoded);
	}

	return encodedParts.join(trackFormatSeparator);
}

function encodeTrack(config, track, trackSheet) {
	const {
		formatDigits: digits, trackFormatAllocation: allocation, trackHeaderLength,
		defaultTrack: { steps: defaultSteps, beats: defaultBeats, bars: defaultBars, phrase: defaultPhrase },
	} = config;
	const strokes = readStrokes(config, track, trackSheet);
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

function readStrokes({ resolution: { bar, beat } }, track, trackSheet) {
	const strokes = [];
	for (let barIndex = 0; barIndex < track.bars; barIndex++) {
		const barOffset = barIndex * bar;
		for (let beatIndex = 0; beatIndex < track.beats; beatIndex++) {
			const beatOffset = barOffset + (beatIndex * beat);
			for (let stepIndex = 0; stepIndex < track.steps; stepIndex++) {
				strokes.push(trackSheet[beatOffset + stepIndex]);
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

function encodeVolumes({ formatDigits: digits, defaultVolume }, { volumes, order }) {
	return order.map(id => digits[volumes[id]]).join('').replace(new RegExp(`${defaultVolume}+$`), '');
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