export function decode(config, searchParams, order = Array.from({ length: config.tracksLength }, (_, id) => id)) {
	const { tracksLength, resolution } = config;
	const param = (key, fallback) => searchParams.get(key) ?? fallback;
	const song  = {
		tempo:   decodeTempo(config, param(config.tempoSearchParam, config.defaultTempo)),
		title:   param(config.titleSearchParam, ''),
		tracks:  [],
		volumes: [],
		sheet:   new Uint8Array(tracksLength * resolution.track),
	};
	decodeSet(config, order, param(config.setSearchParam, config.defaultSetValue), song);
	decodeVolumes(config, order, param(config.volumeSearchParam, config.defaultVolume), song);
	return song;
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

		// Les frappes sont rangées case par case, mesure par mesure, en base « base »
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

function decodeTempo({ defaultTempo, tempoMin, tempoMax, tempoStep }, value) {
	const tempo = Number(value);
	if (!Number.isFinite(tempo)) return defaultTempo;
	const snapped = tempoMin + Math.round((tempo - tempoMin) / tempoStep) * tempoStep;
	return Math.min(tempoMax, Math.max(tempoMin, snapped));
}

function decodeVolumes(config, order, encodedValues, song) {
	const { formatDigits: digits, tracksLength, defaultGain, defaultVolume, maxGain } = config;
	for (let index = 0; index < tracksLength; index++) {
		const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultVolume;
		const decoded      = digits.indexOf(encodeVolume);
		song.volumes[order[index]] = (decoded >= 0 && decoded <= maxGain) ? decoded : defaultGain;
	}
}

function fromCode(code, values, defaultValue) {
	return code && values.includes(code) ? code : defaultValue;
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

function unpack(value, allocation, keys) {
	const result = {};
	for (const key of keys) {
		const base = allocation[key];
		result[key] = value % base;
		value = (value / base) | 0;
	}
	return result;
}