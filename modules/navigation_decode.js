function stringBaseConvert(string, fromBase, base, digits) {
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

export function initialState(config) {
	return {
		tempo:   config.defaultTempo,
		title:   config.defaultTitleValue,
		order:   Array.from({ length: config.tracksLength }, (_, i) => i),
		sheet:   null,
		tracks:  null,
		volumes: null,
	};
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

	const outputBase     = digits.length;
	const allocationKeys = Object.keys(allocation);
	const values         = encodedValues.split(trackFormatSeparator);

	// Une URL malformée peut porter plus de segments que de pistes : on ignore
	// le surplus plutôt que d'indexer `state.order` hors bornes.
	const limitTracks = isVirginTrack ? Math.min(values.length, tracksLength) : tracksLength;

	for (let i = 0; i < limitTracks; i++) {
		const trackChanges = {};
		const id    = state.order[i];
		const track = state.tracks?.[id] || emptyTrack(config, id);
		const data  = (values[i] || '').padEnd(3, defaultSetValue);

		const instrument   = +stringBaseConvert(data.slice(0, 1), outputBase, 10, digits);
		const base         = Math.min(+stringBaseConvert(data.slice(1, 2), outputBase, 10, digits) + 2, 10);
		const packedValues = +stringBaseConvert(data.slice(2, 4), outputBase, 10, digits);
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

		const sheetString = stringBaseConvert(data.slice(4), outputBase, base, digits);
		const limitBars   = isVirginTrack ? params.bars  : maxBars;
		const limitBeats  = isVirginTrack ? params.beats : maxBeats;
		const limitSteps  = isVirginTrack ? params.steps : beat;
		let charPointer   = sheetString.length - 1;

		loop:
		for (let barIndex = 0; barIndex < limitBars; barIndex++) {
			const barOffset   = track.sheetIndex + (barIndex * bar);
			const isBarActive = barIndex < params.bars;

			for (let beatIndex = 0; beatIndex < limitBeats; beatIndex++) {
				const beatOffset   = barOffset + (beatIndex * beat);
				const isBeatActive = isBarActive && beatIndex < params.beats;

				for (let stepIndex = 0; stepIndex < limitSteps; stepIndex++) {
					if (isVirginSheet && charPointer < 0) break loop;

					const bufferIndex = beatOffset + stepIndex;

					const value = (isBeatActive && stepIndex < params.steps && charPointer >= 0)
						? Number(sheetString[charPointer--])
						: 0;

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

function decodeVolumes(config, state, encodedValues, changes) {
	const { formatDigits: digits, tracksLength, defaultGain, defaultVolume } = config;
	const outputBase     = digits.length;
	const volumesChanges = [];

	for (let index = 0; index < tracksLength; index++) {
		const encodeVolume = (index < encodedValues.length) ? encodedValues[index] : defaultVolume;
		const value        = Number(stringBaseConvert(encodeVolume, outputBase, 10, digits));
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

export function decode(config, searchParams, state) {
	const params  = asObject(searchParams);
	const changes = {};

	const set    = params[config.setSearchParam];
	const volume = params[config.volumeSearchParam];
	const tempo  = params[config.tempoSearchParam];
	const title  = params[config.titleSearchParam];

	if (set    != null) decodeSet(config, state, set, changes);
	if (volume != null) decodeVolumes(config, state, volume, changes);
	if (tempo  != null) changes.tempo = tempo;
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