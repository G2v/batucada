export function initialState(config, order = Array.from({ length: config.tracksLength }, (_, i) => i)) {
	return {
		tempo:   config.defaultTempo,
		title:   config.defaultTitleValue,
		order,
		sheet:   null,
		tracks:  null,
		volumes: null,
	};
}

export function decode(config, searchParams, state) {
	const params  = asObject(searchParams);
	const changes = {};

	const set    = params[config.setSearchParam];
	const volume = params[config.volumeSearchParam];
	const tempo  = params[config.tempoSearchParam];
	const title  = params[config.titleSearchParam];

	if (set    != null) decodeSet(config, state, set, changes);
	if (volume != null) decodeVolumes(config, state, volume, changes);
	if (tempo  != null) changes.tempo = decodeTempo(config, tempo);
	if (title  != null) changes.title = title;

	return Object.keys(changes).length === 0 ? null : changes;
}

export function decodeAll(config, searchParams, state) {
	return decode(config, {
		[config.setSearchParam]:    config.defaultSetValue,
		[config.volumeSearchParam]: config.defaultVolume,
		[config.tempoSearchParam]:  config.defaultTempo,
		[config.titleSearchParam]:  config.defaultTitleValue,
		...asObject(searchParams),
	}, state);
}

export function decodeInitial(config, searchParams) {
	return decode(config, searchParams, initialState(config)) ?? {};
}

function decodeSet(config, state, encodedValues, changes) {
	const sheetChanges  = [];
	const tracksChanges = [];
	const isVirginTrack = !state.tracks;
	const isVirginSheet = !state.sheet;
	const {
		formatDigits: digits, trackFormatSeparator, trackFormatAllocation: allocation,
		defaultSetValue, barsIndex, beatsIndex, stepsIndex, phraseIndex, tracksLength,
		defaultBars, defaultBeats, defaultSteps, defaultPhrase,
		resolution: { maxBars, maxBeats, bar, beat },
	} = config;

	const allocationKeys = Object.keys(allocation);
	const values         = encodedValues.split(trackFormatSeparator);

	// Une URL malformée peut porter plus de segments que de pistes : on les ignore
	const limitTracks = isVirginTrack ? Math.min(values.length, tracksLength) : tracksLength;

	for (let i = 0; i < limitTracks; i++) {
		const trackChanges = {};
		const id    = state.order[i];
		const track = state.tracks?.[id] || emptyTrack(config, id);
		const data  = (values[i] || '').padEnd(3, defaultSetValue);

		const instrument   = fromDigits(data.slice(0, 1), digits);
		const base         = BigInt(Math.min(fromDigits(data.slice(1, 2), digits) + 2, 10));
		const packedValues = fromDigits(data.slice(2, 4), digits);
		const paramsValues = unpack(packedValues, allocation, allocationKeys);

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

		// Chiffres lus du poids faible au poids fort : première case de la première mesure d'abord
		let sheetNumber   = toBigInt(data.slice(4), digits);
		const limitBars   = isVirginTrack ? params.bars  : maxBars;
		const limitBeats  = isVirginTrack ? params.beats : maxBeats;
		const limitSteps  = isVirginTrack ? params.steps : beat;

		loop:
		for (let barIndex = 0; barIndex < limitBars; barIndex++) {
			const barOffset   = track.sheetIndex + (barIndex * bar);
			const isBarActive = barIndex < params.bars;

			for (let beatIndex = 0; beatIndex < limitBeats; beatIndex++) {
				const beatOffset   = barOffset + (beatIndex * beat);
				const isBeatActive = isBarActive && beatIndex < params.beats;

				for (let stepIndex = 0; stepIndex < limitSteps; stepIndex++) {
					if (isVirginSheet && sheetNumber === 0n) break loop;

					const bufferIndex = beatOffset + stepIndex;

					let value = 0;
					if (isBeatActive && stepIndex < params.steps && sheetNumber > 0n) {
						value = Number(sheetNumber % base);
						sheetNumber /= base;
					}

					const currentValue = state.sheet?.[bufferIndex] ?? 0;

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

	if (sheetChanges.length)  changes.sheet  = sheetChanges;
	if (tracksChanges.length) changes.tracks = tracksChanges;
}

function decodeTempo({ defaultTempo, tempoMin, tempoMax, tempoStep }, value) {
	const tempo = Number(value);
	if (!Number.isFinite(tempo)) return defaultTempo;
	const snapped = tempoMin + Math.round((tempo - tempoMin) / tempoStep) * tempoStep;
	return Math.min(tempoMax, Math.max(tempoMin, snapped));
}

function decodeVolumes(config, state, encodedValues, changes) {
	const { formatDigits: digits, tracksLength, defaultGain, defaultVolume, maxGain } = config;
	const volumesChanges = [];

	for (let index = 0; index < tracksLength; index++) {
		const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultVolume;
		const decoded      = digits.indexOf(encodeVolume);
		const value        = (decoded >= 0 && decoded <= maxGain) ? decoded : defaultGain;
		const id           = state.order[index];
		const currentValue = state.volumes?.[id] ?? defaultGain;
		if (value !== currentValue) {
			volumesChanges.push({ id, value });
		}
	}

	if (volumesChanges.length > 0) {
		changes.volumes = volumesChanges;
	}
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

function asObject(searchParams) {
	return searchParams instanceof URLSearchParams
		? Object.fromEntries(searchParams.entries())
		: searchParams;
}