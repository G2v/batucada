const lookAhead   = 0.15;
const startDelay  = 0.01;
const config      = {};

let timer           = null;
let order           = null;
let sheet           = null;
let tempo           = null;
let tracks          = null;
let volumes         = null;
let beatSync        = 0;
let beatCounter     = 0;
let phraseCounter   = 0;
let workerSyncDelta = 0;

self.onmessage = ({ data }) => {
	const messages = [];
	const transferables = [];
	const { action, payload } = data;

	switch (action) {
		case 'config':        init(payload); break;
		case 'start':         start(payload); break;
		case 'stop':          stop(); break;
		case 'restart':       restart(); break;
		case 'reset':         reset(messages); break;
		case 'change':        pushMessage('changed', [payload], messages); break;
		case 'setStroke':     setStroke(payload, messages, transferables); break;
		case 'updateData':    updateData(payload, messages, transferables); break;
		case 'moveTrack':     moveTrack(payload, messages); break;
	}

	if (messages.length) {
		self.postMessage(messages, transferables);
	}
};

function init(payload) {
	Object.assign(config, payload);
	Object.freeze(config);

	order    = config.order;
	sheet    = new Uint8Array(config.tracksLength * config.resolution.track).fill(config.emptyStroke);
	tempo    = config.tempo;
	beatSync = config.defaultData.bars * config.defaultData.beats;
	volumes  = new Array(config.tracksLength).fill(config.defaultData.volume);
	tracks   = Array.from({ length: config.tracksLength }, (_, index) => {
		return {
			bars:       config.defaultData.bars,
			beats:      config.defaultData.beats,
			steps:      config.defaultData.steps,
			phrase:     config.defaultData.phrase,
			instrument: config.defaultData.instrument,
			sheetIndex: config.resolution.track * index,
			active:     index === 0,
		};
	});
}

function start(time) {
	const startTime = time + startDelay;
	beatCounter = 0;
	phraseCounter = 1;
	workerSyncDelta = (startTime * 1000) - performance.now();
	scheduler(startTime);
}

function restart() {
	beatCounter = 0;
	phraseCounter = 0;
}

function stop() {
	clearTimeout(timer);
	timer = null;
}

function scheduler(nextTickTime) {
	let noteCount = 0;
	const secondsPerBar = 60 / tempo;
	const ticksBuffer = new Float64Array(tracks.length * config.resolution.track * 5);

	const currentPhraseBeats = tracks
		.filter(track => track.active && track.phrase === phraseCounter)
		.reduce((max, track) => Math.max(max, track.bars * track.beats), 0);

	const limit = (phraseCounter === 0) ? beatSync : currentPhraseBeats;

	for (const [trackIndex, track] of tracks.entries()) {
		const { instrument, bars, beats, steps, active, phrase, sheetIndex } = track;
		const totalBeats = bars * beats;
		if (!active || phrase !== phraseCounter || (phrase !== 0 && beatCounter >= totalBeats)) continue;

		const barCount = Math.floor((beatCounter % totalBeats) / beats);
		const beatIndex = (barCount * config.resolution.maxBeats) + (beatCounter % beats);
		const beatOffset = sheetIndex + (beatIndex * config.resolution.beat);
		const secondsPerStep = secondsPerBar / steps;

		for (let stepOffset = 0; stepOffset < steps; stepOffset++) {
			const stepIndex = beatOffset + stepOffset;
			const offset = noteCount * 5;
			ticksBuffer[offset]     = nextTickTime + (stepOffset * secondsPerStep);
			ticksBuffer[offset + 1] = sheet[stepIndex];
			ticksBuffer[offset + 2] = instrument;
			ticksBuffer[offset + 3] = trackIndex;
			ticksBuffer[offset + 4] = stepIndex;
			noteCount++;
		}
	}

	if (beatCounter < limit) {
		const ticks = ticksBuffer.subarray(0, noteCount * 5);
		self.postMessage([{ action: 'ticks', payload: ticks }], [ticks.buffer]);
		beatCounter++;
		const targetTime = nextTickTime + secondsPerBar;
		const delay = targetTime * 1000 - workerSyncDelta - performance.now() - (lookAhead * 1000);
		timer = setTimeout(() => scheduler(targetTime), Math.max(0, delay));
	}

	else {
		const nextPhrase = phraseCounter + 1;
		const hasNextPhrase = tracks.some(track => track.active && track.phrase === nextPhrase);
		const hasLoop = tracks.some(track => track.active && track.phrase === 0);
		if (phraseCounter !== 0 && hasNextPhrase) {
			phraseCounter = nextPhrase;
		} 
		else if (hasLoop) {
			phraseCounter = 0;
		} 
		else {
			timer = null;
			return self.postMessage([{ action: 'stop' }]);
		}
		beatCounter = 0;
		scheduler(nextTickTime);
	}
}


function setStroke({ sheet: change }, messages, transferables) {
	const [{ stepIndex, value }] = change;
	const trackIndex = (stepIndex / config.resolution.track) | 0;
	const instrument = tracks[trackIndex].instrument;
	const stroke = (value + 1) % (config.instrumentsStrokes[instrument] + 1);
	change[0].value = stroke;
	sheet[stepIndex] = stroke;
	const payload = { sheet: change };
	messages.push({ action: 'updateData', payload });
	if (stroke > config.emptyStroke && !timer) {
		const note = { gainIndex: trackIndex, instrument, stroke };
		messages.push({ action: 'playNote', payload: note });
	}
	pushMessage('changed', ['sheet'], messages, transferables);
}

function pushMessage(action, items, messages, transferables) {
	const payload = {};
	if (items.includes('tempo'))   payload.tempo   = tempo;
	if (items.includes('tracks'))  payload.tracks  = tracks;
	if (items.includes('volumes')) payload.volumes = volumes;
	if (items.includes('sheet')) {
		payload.sheet = new Uint8Array(sheet);
		transferables.push(payload.sheet.buffer);
	}
	messages.push({ action, payload });
}

function getBeatSync() {
	const gcd = (a, b) => a ? gcd(b % a, a) : b;
	const lcm = (a, b) => (a * b) / gcd(a, b);
	const beats = tracks
		.filter(track => track.active && track.phrase === 0)
		.map(track => track.bars * track.beats);
	return beats.length ? beats.reduce((a, b) => lcm(a, b)) : 0;
}

function updateData(changes, messages, transferables) {
	const items = new Set();
	const collateralItems = new Set();
	const { 
		tempo:   tempoValue,
		sheet:   sheetValues,
		tracks:  tracksValues,
		volumes: volumesValues,
		sendState,
	} = changes;

	if (tempoValue    !== undefined) tempo = tempoValue;
	if (sheetValues   !== undefined) updateSheet(sheetValues, items);
	if (tracksValues  !== undefined) updateTracks(tracksValues, items, collateralItems, messages);
	if (volumesValues !== undefined) updateVolumes(volumesValues); 

	if (items.size > 0 || collateralItems.size > 0) {
		if (sendState) {
			if (items.size > 0) {
				pushMessage('state', Array.from(items), messages, transferables);
			}
			if (collateralItems.size > 0) {
				pushMessage('changed', Array.from(collateralItems), messages, transferables);
			}
		}
		else {
			const allItems = new Set([...items, ...collateralItems]);
			pushMessage('changed', Array.from(allItems), messages, transferables);
		}
	}
}

function updateTracks(values, items, collateralItems, messages) {
	const sheetChanges = [];
	const volumeChanges = [];

	for (const { id, changes } of values) {
		const track = tracks[id];
		
		for (const [item, value] of Object.entries(changes)) {
			track[item] = value;

			let resetValue;
			let resetCondition;

			if (item === 'instrument') {
				updateNextTrack(id, value, volumeChanges);
				resetValue     = config.instrumentsStrokes[value];
				resetCondition = (stepValue) => stepValue > resetValue;
			} 
			else if (item === 'bars' || item === 'beats' || item === 'steps') {
				resetValue = config.emptyStroke;
				if (item === 'bars')  resetCondition = (_, bars, beats, step) => bars  >= value;
				if (item === 'beats') resetCondition = (_, bars, beats, step) => beats >= value;
				if (item === 'steps') resetCondition = (_, bars, beats, step) => step  >= value;
			}
			if (resetCondition) {
				const resetChanges = updateSheetWith(track, resetValue, resetCondition);
				if (resetChanges.length) sheetChanges.push(...resetChanges);
			}
		}
	}

	if (sheetChanges.length) {
		collateralItems.add('sheet');
		messages.push({ action: 'updateData', payload: { sheet: sheetChanges } });
	}
	if (volumeChanges.length) {
		collateralItems.add('volumes');
		messages.push({ action: 'updateData', payload: { volumes: volumeChanges } });
	}
	items.add('tracks')
	beatSync = getBeatSync();
}

	function updateSheetWith(track, resetValue, condition) {
		const changes = [];
		const { 
			maxBeats,
			beat:  stepsPerBeat, 
			track: stepsPerTrack,
		} = config.resolution;

		let bars = 0;
		let beats = 0;
		let steps = 0;
		let stepIndex = track.sheetIndex;

		for (let i = 0; i < stepsPerTrack; i++) {
			if (condition(sheet[stepIndex], bars, beats, steps) && sheet[stepIndex] !== resetValue) {
				sheet[stepIndex] = resetValue;
				changes.push({ stepIndex, value: resetValue });
			}
			stepIndex++;
			steps++;
			if (steps === stepsPerBeat) {
				steps = 0;
				beats++;
				if (beats === maxBeats) {
					beats = 0;
					bars++;
				}
			}
		}
		return changes;
	}

function updateSheet(values, items) {
	for (const { stepIndex, value } of values) {
		sheet[stepIndex] = value;
	}
	items.add('sheet');
}

function updateVolumes(values) {
	for (const { id, value } of values) {
		volumes[id] = Number(value);
	}
}

function pushChanges(changes, messages) {
	if (!changes || Object.keys(changes).length === 0) return;
	messages.push({ action: 'updateData', payload: changes });
	if (changes.volumes) {
		messages.push({ action: 'updateGains', payload: changes.volumes });
	}
}

function updateNextTrack(index, instrument, volumeChange) {
	const id = order[order.indexOf(index) + 1];
	if (id === undefined) return;
	const nextTrack = tracks[id];
	const value = config.defaultData.volume;
	nextTrack.active = instrument !== config.defaultData.instrument;
	if (!nextTrack.active && volumes[id] !== value) {
		volumes[id] = value;
		volumeChange.push({ id, value });
	}
}

function reset(messages) {
	const changes = resetTracks();
	if (tempo !== config.tempo) {
		tempo = config.tempo;
		changes.tempo = tempo;
	}
	pushChanges(changes, messages);
}

function moveTrack({ trashed, order: newOrder }, messages) {
	if (trashed !== null) {
		if (tracks[trashed].instrument === config.defaultData.instrument) {
			const nextIndex = order[order.indexOf(trashed) + 1];
			if (nextIndex !== undefined) {
				tracks[nextIndex].active = true;
			}
		}
		pushChanges(resetTracks(trashed), messages);
	}
	order = newOrder;
}

function resetTracks(targetId = null) {
	const changes = {};
	const { defaultData, emptyStroke, resolution } = config;

	const isFullReset = targetId === null;
	const start = isFullReset ? 0 : tracks[targetId].sheetIndex;
	const end = isFullReset ? sheet.length : start + resolution.track;

	const sheetChanges = [];
	for (let stepIndex = start; stepIndex < end; stepIndex++) {
		if (sheet[stepIndex] !== emptyStroke) {
			sheetChanges.push({ stepIndex: stepIndex, value: emptyStroke });
		}
	}
	if (sheetChanges.length) changes.sheet = sheetChanges;
	sheet.fill(emptyStroke, start, end);

	const tracksChanges = [];
	const volumesChanges = [];
	const tracksRange = isFullReset ? order : [targetId];

	for (const id of tracksRange) {
		const track = tracks[id];
		const trackChanges = {};
		track.active = isFullReset ? (id === order[0]) : track.active;
		Object.keys(track).forEach(key => {
			if (defaultData.hasOwnProperty(key) && track[key] !== defaultData[key]) {
				track[key] = defaultData[key];
				trackChanges[key] = defaultData[key];
			}
		});

		if (Object.keys(trackChanges).length) {
			tracksChanges.push({ id, changes: trackChanges });
		}

		if (volumes[id] !== defaultData.volume) {
			volumes[id] = defaultData.volume;
			volumesChanges.push({ id, value: defaultData.volume });
		}
	}

	if (tracksChanges.length) {
		beatSync = getBeatSync();
		changes.tracks = tracksChanges;
	}
	if (volumesChanges.length) {
		changes.volumes = volumesChanges;
	}
	return changes;
}