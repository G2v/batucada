const lookAhead   = 0.15;
const startDelay  = 0.01;

let config          = null;
let timer           = null;
let tempo           = null;
let tracks          = [];
let sheet           = new Uint8Array(0);
let beatCounter     = 0;
let phraseCounter   = 0;
let workerSyncDelta = 0;

self.onmessage = ({ data: { action, payload } }) => {
	switch (action) {
		case 'config':  config = payload; break;
		case 'song':    ({ tracks, tempo, sheet } = payload); break;
		case 'start':   start(payload); break;
		case 'stop':    stop(); break;
		case 'restart': restart(); break;
	}
};

function start(time) {
	if (timer !== null) return;
	const startTime = time + startDelay;
	restart();
	workerSyncDelta = (startTime * 1000) - performance.now();
	scheduler(startTime);
}

function restart() {
	beatCounter = 0;
	phraseCounter = 1;
}

function stop() {
	clearTimeout(timer);
	timer = null;
}

function scheduler(nextTickTime) {
	if (!updatePhrase()) {
		timer = null;
		return self.postMessage({ action: 'stop' });
	}

	let noteCount = 0;
	const secondsPerBeat = 60 / tempo;
	const ticksBuffer = new Float64Array(tracks.length * config.resolution.beat * 5);

	for (const { id, instrument, bars, beats, steps, phrase } of tracks) {
		const totalBeats = bars * beats;
		if (phrase !== phraseCounter || (phrase !== 0 && beatCounter >= totalBeats)) continue;

		const barCount = Math.floor((beatCounter % totalBeats) / beats);
		const beatIndex = (barCount * config.resolution.maxBeats) + (beatCounter % beats);
		const beatOffset = (id * config.resolution.track) + (beatIndex * config.resolution.beat);
		const secondsPerStep = secondsPerBeat / steps;

		for (let stepOffset = 0; stepOffset < steps; stepOffset++) {
			const stepIndex = beatOffset + stepOffset;
			const offset = noteCount * 5;
			ticksBuffer[offset]     = nextTickTime + (stepOffset * secondsPerStep);
			ticksBuffer[offset + 1] = sheet[stepIndex];
			ticksBuffer[offset + 2] = instrument;
			ticksBuffer[offset + 3] = id;
			ticksBuffer[offset + 4] = stepIndex;
			noteCount++;
		}
	}

	const ticks = ticksBuffer.subarray(0, noteCount * 5);
	self.postMessage({ action: 'ticks', payload: ticks }, [ticks.buffer]);
	beatCounter++;
	scheduleNext(nextTickTime + secondsPerBeat);
}

function phraseLength(phrase) {
	const length = tracks
		.filter(track => track.phrase === phrase)
		.reduce((max, track) => Math.max(max, track.bars * track.beats), 0);
	return (phrase === 0 && length) ? Infinity : length;
}

function updatePhrase() {
	while (beatCounter >= phraseLength(phraseCounter)) {
		if (phraseCounter === 0) return false;
		const nextPhrase = tracks
			.filter(track => track.phrase > phraseCounter)
			.reduce((min, track) => Math.min(min, track.phrase), Infinity);
		if (nextPhrase !== Infinity) phraseCounter = nextPhrase;
		else if (phraseLength(0)) phraseCounter = 0;
		else return false;
		beatCounter = 0;
	}
	return true;
}

function scheduleNext(targetTime) {
	const delay = targetTime * 1000 - workerSyncDelta - performance.now() - (lookAhead * 1000);
	timer = setTimeout(() => scheduler(targetTime), Math.max(0, delay));
}