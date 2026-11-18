import { buildStyles, buildTracks, buildInstruments } from './build-dom.js';

export class Interface {
	static #movingClass = 'moving';
	static #modules = Object.freeze([
		{ name: 'controls',    path: './interface_controls.js' },
		{ name: 'dialogs',     path: './interface_dialogs.js' },
		{ name: 'animation',   path: './interface_animation.js' },
		{ name: 'savedSongs',  path: './interface_saved-songs.js' },
		{ name: 'instruments', path: './interface_instruments.js' },
		{ name: 'aria',        path: './interface_aria.js' },
		{ name: 'swap',        path: './interface_swap.js' },
		{ name: 'app',         path: './interface_app.js' },
	]);

	#song;
	#untitled;
	#selectors;
	#resolution;
	#trackKeys;
	#emptyStroke;

	#tracksReady     = Promise.withResolvers();
	#nodes           = {};
	#instances       = {};
	#headTitlePrefix = `${document.title} - `;

	constructor(params) {
		const { config, song, savedSongs } = params;
		this.#song              = song;
		this.#selectors         = config.selectors;
		this.#resolution        = config.resolution;
		this.#trackKeys         = Object.keys(config.defaultTrack);
		this.#emptyStroke       = config.emptyStroke;

		song.addEventListener('change',       ({ detail }) => this.#render(detail));
		savedSongs.addEventListener('change', ({ detail }) => this.#savedSongsUpdated(detail));

		this.#build(params);
		this.#loadModules(params);
	}

	#build({ config }) {
		const addTracks = (start, end) => {
			const { nodes, fragment } = buildTracks(config, this.trackTemplate, start, end);
			for (const [key, list] of Object.entries(nodes)) (this.#nodes[key] ??= []).push(...list);
			this.#renderTracks(start, this.#nodes.tracks.length);
			buildInstruments(config, nodes).catch(reportError);
			return fragment;
		};

		buildStyles(config).catch(reportError);

		this.#tempo = this.#song.tempo;
		this.#title = this.#song.title;
		document.documentElement.style.removeProperty('--untitled');

		const activeCount = this.#song.activeTracks.length;
		let firstCount = 0;
		do {
			this.trackList.appendChild(addTracks(firstCount, firstCount + 1));
			firstCount++;
		} while (firstCount < activeCount && this.#nodes.tracks[firstCount - 1].getBoundingClientRect().bottom < innerHeight);

		requestAnimationFrame(() => setTimeout(() => {
			this.trackList.appendChild(addTracks(firstCount));
			document.documentElement.style.removeProperty('--tracks-count');
			this.#tracksReady.resolve();
		}));
	}

	#loadModules(params) {
		Interface.#modules.forEach(({ name, path }) => {
			Promise.all([import(path), this.#tracksReady.promise]).then(([module]) => {
				this.#instances[name] = new module.default({ ...params, parent: this });
			});
		});
	}

	#render({ tempo, title, tracks, steps, volumes, moved }) {
		if (tempo) this.#tempo = this.#song.tempo;
		if (title) this.#title = this.#song.title;
		tracks.forEach(id => this.#renderTrack(id));
		steps.forEach(index => this.#renderStep(index));
		volumes.forEach(id => this.#renderVolume(id));
		if (moved !== undefined) this.#renderMove(moved);
	}

	#renderTracks(start, end) {
		const { sheet } = this.#song;
		const { track: stepsPerTrack } = this.#resolution;
		for (let id = start; id < end; id++) {
			this.#renderTrack(id);
			this.#renderVolume(id);
			for (let index = id * stepsPerTrack; index < (id + 1) * stepsPerTrack; index++) {
				if (sheet[index] !== this.#emptyStroke) this.#renderStep(index);
			}
		}
	}

	#renderTrack(id) {
		const track = this.#nodes.tracks[id];
		if (!track) return;
		const values = this.#song.tracks[id];
		for (const key of this.#trackKeys) {
			if (track.dataset[key] !== String(values[key])) track.dataset[key] = values[key];
		}
		this.#nodes.instruments[id].value = values.instrument;
	}

	#renderStep(index) {
		const step = this.#nodes.steps[index];
		if (step) step.value = this.#song.sheet[index];
	}

	#renderVolume(id) {
		const volume = this.#nodes.volumes[id];
		const value  = this.#song.volumes[id];
		if (volume && (volume.value | 0) !== value) volume.value = value;
	}

	#renderMove(id) {
		const { order } = this.#song;
		const next = order[order.indexOf(id) + 1];
		this.trackList.insertBefore(this.#nodes.tracks[id], this.#nodes.tracks[next] ?? null);
	}

	set #title(value) {
		this.#sequenceTitle.textContent = value;
		document.title = this.#headTitlePrefix + (value || this.untitled);
	}

	set #tempo(value) {
		this.tempoSlider.value = value;
		this.#tempoValue.textContent = value;
	}

	get #sequenceTitle() { return this.#nodes.sequenceTitle ??= document.querySelector(this.#selectors.sequenceTitle); }
	get #tempoValue()    { return this.#nodes.tempoValue    ??= document.querySelector(this.#selectors.tempoValue); }

	#savedSongsUpdated({ savedSongs, index }) {
		if (savedSongs !== undefined) {
			this.savedSongsSelect.options.length = 0;
			this.savedSongsSelect.append(...savedSongs.map(({ name }) => new Option(name || this.untitled)));
		}
		if (index !== undefined) this.savedSongsSelect.selectedIndex = index;
	}

	getStepIndex(step) {
		return this.#nodes.steps.indexOf(step);
	}

	getTrack(child)           { return child.closest(this.#selectors.track); }
	getTrackIndex(track)      { return track.dataset.index | 0; }

	startViewTransition(callback, moving = null) {
		moving?.classList.add(Interface.#movingClass);
		document.startViewTransition({ update: callback, types: ['tracks'] })
			.finished.finally(() => moving?.classList.remove(Interface.#movingClass));
	}

	get steps()         { return this.#nodes.steps; }
	get tracks()        { return this.#nodes.tracks; }
	get volumes()       { return this.#nodes.volumes; }
	get instruments()   { return this.#nodes.instruments; }

	get tempoSlider()      { return this.#nodes.tempoSlider      ??= document.querySelector(this.#selectors.tempoSlider); }
	get savedSongsSelect() { return this.#nodes.savedSongsSelect ??= document.querySelector(this.#selectors.savedSongsSelect); }
	get container()        { return this.#nodes.container        ??= document.querySelector(this.#selectors.container); }
	get startButton()      { return this.#nodes.startButton      ??= document.querySelector(this.#selectors.startButton); }
	get trackList()        { return this.#nodes.trackList        ??= document.querySelector(this.#selectors.trackList); }
	get trackTemplate()    { return this.#nodes.trackTemplate    ??= document.querySelector(this.#selectors.trackTemplate).content.querySelector(this.#selectors.track); }
	get untitled()         { return this.#untitled               ??= document.querySelector(this.#selectors.untitledLabel).textContent; }

	get swap()          { return this.#instances.swap; }
	get dialogs()       { return this.#instances.dialogs; }
}