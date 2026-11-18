export class Song extends EventTarget {
	#trackKeys;
	#resolution;
	#tracksLength;
	#emptyStroke;
	#defaultGain;
	#defaultTempo;
	#defaultTrack;

	#state;
	#strokes = {};

	constructor(config, initial = null) {
		super();
		this.#trackKeys    = Object.keys(config.defaultTrack);
		this.#resolution   = config.resolution;
		this.#tracksLength = config.tracksLength;
		this.#emptyStroke  = config.emptyStroke;
		this.#defaultGain  = config.defaultGain;
		this.#defaultTempo = config.defaultTempo;
		this.#defaultTrack = config.defaultTrack;

		const order = Array.from({ length: config.tracksLength }, (_, id) => id);
		this.#state = { ...(initial ?? this.#emptySong()), order };

		config.instrumentsLibraryReady.then(({ instruments }) => this.#setLibrary(instruments), () => {});
	}

	get tempo()   { return this.#state.tempo; }
	get title()   { return this.#state.title; }
	get order()   { return this.#state.order; }
	get tracks()  { return this.#state.tracks; }
	get volumes() { return this.#state.volumes; }
	get sheet()   { return this.#state.sheet; }

	get activeTracks() {
		const { order } = this.#state;
		const end = order.findIndex(id => this.isEmpty(id));
		return end === -1 ? order : order.slice(0, end + 1);
	}

	isEmpty(id) {
		return this.#state.tracks[id].instrument === this.#defaultTrack.instrument;
	}

	#setLibrary(instruments) {
		this.#strokes = Object.fromEntries(instruments.map(({ id, strokes }) => [id, strokes.length]));
		const steps = new Set();
		this.#state.order.forEach(id => this.#cleanTrack(id, steps));
		if (steps.size) this.#commit({ steps, corrected: true });
	}

	load(data) {
		const changes   = this.#replace(data);
		const corrected = new Set();
		this.#state.order.forEach(id => this.#cleanTrack(id, corrected));
		corrected.forEach(index => changes.steps.add(index));
		const changed = changes.tempo || changes.title || changes.tracks.size || changes.volumes.size || changes.steps.size;
		if (changed) this.#commit({ ...changes, loaded: true, corrected: corrected.size > 0 });
	}

	reset() {
		this.#commit({ ...this.#replace(this.#emptySong()), reset: true });
	}

	setTempo(tempo, { transient = false } = {}) {
		this.#state.tempo = tempo;
		this.#commit({ tempo: true, transient });
	}

	setTitle(title) {
		this.#state.title = title;
		this.#commit({ title: true });
	}

	toggleStroke(index) {
		const { tracks, sheet } = this.#state;
		const id  = index / this.#resolution.track | 0;
		const max = this.#strokes[tracks[id].instrument] ?? 1;
		sheet[index] = (sheet[index] + 1) % (max + 1);
		this.#commit({ steps: new Set([index]) });
		return sheet[index];
	}

	setTrack(id, changes) {
		const { order, tracks, volumes } = this.#state;
		const ids            = new Set([id]);
		const changedSteps   = new Set();
		const changedVolumes = new Set();
		const wasEmpty       = this.isEmpty(id);
		const next           = order[order.indexOf(id) + 1];
		Object.assign(tracks[id], changes);
		this.#cleanTrack(id, changedSteps);

		if (changes.instrument !== undefined && next !== undefined) {
			if (wasEmpty && this.isEmpty(next)) {
				const { beats, steps } = tracks[id];
				if (tracks[next].beats !== beats || tracks[next].steps !== steps) {
					Object.assign(tracks[next], { beats, steps });
					this.#cleanTrack(next, changedSteps);
					ids.add(next);
				}
			}
			// Instrument retiré : la piste suivante redevient une piste vide, à volume par défaut
			if (this.isEmpty(id) && volumes[next] !== this.#defaultGain) {
				volumes[next] = this.#defaultGain;
				changedVolumes.add(next);
			}
		}
		this.#commit({ tracks: ids, steps: changedSteps, volumes: changedVolumes });
	}

	setVolume(id, value, { transient = false } = {}) {
		this.#state.volumes[id] = value;
		this.#commit({ volumes: new Set([id]), transient });
	}

	moveTrack(id, beforeId = null) {
		const { order } = this.#state;
		const position = order.indexOf(id);
		if (id === beforeId || (order[position + 1] ?? null) === beforeId) return;
		order.splice(position, 1);
		order.splice(beforeId === null ? order.length : order.indexOf(beforeId), 0, id);
		this.#commit({ order: true, moved: id });
	}

	trashTrack(id) {
		const { order, tracks, volumes, sheet } = this.#state;
		const start = id * this.#resolution.track;
		const end   = start + this.#resolution.track;
		const steps = new Set();
		for (let index = start; index < end; index++) {
			if (sheet[index] !== this.#emptyStroke) steps.add(index);
		}
		sheet.fill(this.#emptyStroke, start, end);
		const changedTracks  = this.#trackKeys.some(key => tracks[id][key] !== this.#defaultTrack[key]) ? [id] : [];
		const changedVolumes = volumes[id] !== this.#defaultGain ? [id] : [];
		tracks[id]  = { ...this.#defaultTrack };
		volumes[id] = this.#defaultGain;
		order.splice(order.indexOf(id), 1);
		order.push(id);
		this.#commit({ tracks: new Set(changedTracks), steps, volumes: new Set(changedVolumes), order: true, moved: id, trashed: id });
	}

	#emptySong() {
		return {
			tempo:   this.#defaultTempo,
			title:   '',
			tracks:  Array.from({ length: this.#tracksLength }, () => ({ ...this.#defaultTrack })),
			volumes: new Array(this.#tracksLength).fill(this.#defaultGain),
			sheet:   new Uint8Array(this.#tracksLength * this.#resolution.track),
		};
	}

	static #emptyChanges() {
		return { tracks: new Set(), steps: new Set(), volumes: new Set() };
	}

	#commit(changes) {
		this.dispatchEvent(new CustomEvent('change', { detail: { ...Song.#emptyChanges(), ...changes } }));
	}

	#cleanTrack(id, steps) {
		const { tracks, sheet } = this.#state;
		const { bars, beats, steps: perBeat, instrument } = tracks[id];
		const { bar, beat, track } = this.#resolution;
		const max   = this.#strokes[instrument] ?? Infinity;
		const start = id * track;
		for (let local = 0; local < track; local++) {
			const index = start + local;
			const value = sheet[index];
			if (value === this.#emptyStroke) continue;
			const outside = (local / bar | 0) >= bars
				|| ((local % bar) / beat | 0) >= beats
				|| local % beat >= perBeat;
			const next = outside ? this.#emptyStroke : Math.min(value, max);
			if (next !== value) {
				sheet[index] = next;
				steps.add(index);
			}
		}
	}

	#replace({ tempo, title, tracks, volumes, sheet }) {
		const state   = this.#state;
		const changes = { ...Song.#emptyChanges(), tempo: tempo !== state.tempo, title: title !== state.title };
		state.tempo = tempo;
		state.title = title;
		tracks.forEach((track, id) => {
			if (this.#trackKeys.some(key => track[key] !== state.tracks[id][key])) changes.tracks.add(id);
			state.tracks[id] = { ...track };
		});
		volumes.forEach((volume, id) => {
			if (volume !== state.volumes[id]) changes.volumes.add(id);
			state.volumes[id] = volume;
		});
		sheet.forEach((value, index) => {
			if (value !== state.sheet[index]) changes.steps.add(index);
		});
		state.sheet.set(sheet);
		return changes;
	}
}