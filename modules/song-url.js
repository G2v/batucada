import { normalizeName } from './utils.js';

export function encodeSong(config, { values, song, searchParams }) {
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

export function decodeSong(config, searchParams, order = Array.from({ length: config.tracksLength }, (_, id) => id)) {
	const { tracksLength, resolution } = config;
	const param = (key, fallback) => searchParams.get(key) ?? fallback;
	const song  = {
		tempo:   decodeTempo(config, param(config.tempoSearchParam, config.defaultTempo)),
		title:   decodeTitle(config, searchParams),
		tracks:  [],
		volumes: [],
		sheet:   new Uint8Array(tracksLength * resolution.track),
	};
	decodeSet(config, order, param(config.setSearchParam, config.defaultSetValue), song);
	decodeVolumes(config, order, param(config.volumeSearchParam, config.defaultVolume), song);
	return song;
}

export function decodeTitle({ titleSearchParam }, searchParams) {
	return normalizeName(searchParams.get(titleSearchParam) ?? '');
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

function decodeSet(config, order, encodedValues, song) {
	const {
		formatDigits: digits, trackFormatSeparator, trackFormatAllocation: allocation, trackHeaderLength,
		defaultSetValue, defaultTrack, barsValues, beatsValues, stepsValues, phraseValues,
		tracksLength, resolution: { bar, beat, track: trackSize },
	} = config;

	const allocationKeys = Object.keys(allocation);
	const values         = encodedValues.split(trackFormatSeparator);

	for (let i = 0; i < tracksLength; i++) {
		const id     = order[i];
		const data   = (values[i] || '').padEnd(trackHeaderLength, defaultSetValue);
		const packed = unpack(fromDigits(data.slice(1, trackHeaderLength), digits), allocation, allocationKeys);
		const base   = BigInt(packed.base + 2);
		const track  = {
			bars:       fromCode(packed.bars,   barsValues,   defaultTrack.bars),
			beats:      fromCode(packed.beats,  beatsValues,  defaultTrack.beats),
			steps:      fromCode(packed.steps,  stepsValues,  defaultTrack.steps),
			phrase:     fromCode(packed.phrase, phraseValues, defaultTrack.phrase),
			instrument: fromDigits(data.slice(0, 1), digits),
		};
		song.tracks[id] = track;

		const start     = id * trackSize;
		let sheetNumber = toBigInt(data.slice(trackHeaderLength), digits);
		for (let barIndex = 0; barIndex < track.bars && sheetNumber > 0n; barIndex++) {
			for (let beatIndex = 0; beatIndex < track.beats && sheetNumber > 0n; beatIndex++) {
				for (let stepIndex = 0; stepIndex < track.steps && sheetNumber > 0n; stepIndex++) {
					song.sheet[start + barIndex * bar + beatIndex * beat + stepIndex] = Number(sheetNumber % base);
					sheetNumber /= base;
				}
			}
		}
	}
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

function encodeVolumes({ formatDigits: digits, defaultVolume }, { volumes, order }) {
	return order.map(id => digits[volumes[id]]).join('').replace(new RegExp(`${defaultVolume}+$`), '');
}

function decodeVolumes(config, order, encodedValues, song) {
	const { formatDigits: digits, tracksLength, defaultGain, defaultVolume, maxGain } = config;
	for (let index = 0; index < tracksLength; index++) {
		const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultVolume;
		const decoded      = digits.indexOf(encodeVolume);
		song.volumes[order[index]] = (decoded >= 0 && decoded <= maxGain) ? decoded : defaultGain;
	}
}

function decodeTempo({ defaultTempo, tempoMin, tempoMax, tempoStep }, value) {
	const tempo = Number(value);
	if (!Number.isFinite(tempo)) return defaultTempo;
	const snapped = tempoMin + Math.round((tempo - tempoMin) / tempoStep) * tempoStep;
	return Math.min(tempoMax, Math.max(tempoMin, snapped));
}

function toCode(value, defaultValue) {
	return value === defaultValue ? 0 : value;
}

function fromCode(code, values, defaultValue) {
	return code && values.includes(code) ? code : defaultValue;
}

function pack(values, allocation) {
	const keys = Object.keys(allocation);
	let packed = 0;
	for (let i = keys.length - 1; i >= 0; i--) {
		packed = packed * allocation[keys[i]] + values[keys[i]];
	}
	return packed;
}

function unpack(value, allocation, keys) {
	const result = {};
	for (const key of keys) {
		const base = allocation[key];
		result[key] = value % base;
		value = (value / base) | 0;
	}
	return result;
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

function fromDigits(string, digits) {
	let number = 0;
	for (const char of string) number = number * digits.length + digits.indexOf(char);
	return Math.max(number, 0);
}

function toBigInt(string, digits) {
	const base = BigInt(digits.length);
	let number = 0n;
	for (const char of string) number = number * base + BigInt(digits.indexOf(char));
	return number > 0n ? number : 0n;
}