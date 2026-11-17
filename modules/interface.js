import { normalizeName } from './utils.js';
import { buildStyles, buildTracks, buildInstruments } from './build-dom.js';

export class Interface {
	static #movingClass = 'moving';
	static #modules = Object.freeze([
		{ name: 'controls',    path: './interface_controls.js' },
		{ name: 'dialogs',     path: './interface_dialogs.js' },
		{ name: 'animation',   path: './interface_animation.js' },
		{ name: 'presets',     path: './interface_presets.js' },
		{ name: 'instruments', path: './interface_instruments.js' },
		{ name: 'aria',        path: './interface_aria.js' },
		{ name: 'swap',        path: './interface_swap.js' },
		{ name: 'app',         path: './interface_app.js' },
	]);

	#store;
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
		const { config, store, presets } = params;
		this.#store             = store;
		this.#selectors         = config.selectors;
		this.#resolution        = config.resolution;
		this.#trackKeys         = Object.keys(config.defaultTrack);
		this.#emptyStroke       = config.emptyStroke;

		store.addEventListener('change',   ({ detail }) => this.#render(detail));
		presets.addEventListener('change', ({ detail }) => this.#presetsUpdated(detail));

		this.#build(params);
		this.#loadModules(params);
	}

	#build({ config }) {
		const { state } = this.#store;
		const addTracks = (start, end) => {
			const { nodes, fragment } = buildTracks(config, this.trackTemplate, start, end);
			for (const [key, list] of Object.entries(nodes)) (this.#nodes[key] ??= []).push(...list);
			this.#renderTracks(start, this.#nodes.tracks.length);
			buildInstruments(config, nodes).catch(reportError);
			return fragment;
		};

		buildStyles(config).catch(reportError);

		const lastModified = state.tracks.findLastIndex((_, id) => this.#store.isModified(id));
		const firstCount   = Math.min(config.tracksLength, lastModified + 2);
		const fragment     = addTracks(0, firstCount);
		this.#tempo = state.tempo;
		this.#title = state.title;

		document.documentElement.style.removeProperty('--untitled');
		document.documentElement.style.removeProperty('--tracks-count');
		this.trackList.appendChild(fragment);

		requestAnimationFrame(() => setTimeout(() => {
			this.trackList.appendChild(addTracks(firstCount));
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
		const { state } = this.#store;
		if (tempo) this.#tempo = state.tempo;
		if (title) this.#title = state.title;
		tracks.forEach(id => this.#renderTrack(id));
		steps.forEach(index => this.#renderStep(index));
		volumes.forEach(id => this.#renderVolume(id));
		if (moved !== undefined) this.#renderMove(moved);
	}

	#renderTracks(start, end) {
		const { sheet } = this.#store.state;
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
		const values = this.#store.state.tracks[id];
		for (const key of this.#trackKeys) {
			if (track.dataset[key] !== String(values[key])) track.dataset[key] = values[key];
		}
		this.#nodes.instruments[id].value = values.instrument;
	}

	#renderStep(index) {
		const step = this.#nodes.steps[index];
		if (step) step.value = this.#store.state.sheet[index];
	}

	#renderVolume(id) {
		const volume = this.#nodes.volumes[id];
		const value  = this.#store.state.volumes[id];
		if (volume && (volume.value | 0) !== value) volume.value = value;
	}

	#renderMove(id) {
		const { order } = this.#store.state;
		const next = order[order.indexOf(id) + 1];
		this.trackList.insertBefore(this.#nodes.tracks[id], this.#nodes.tracks[next] ?? null);
	}

	set #title(value) {
		const titleText = normalizeName(value);
		this.sequenceTitle.textContent = titleText;
		document.title = this.#headTitlePrefix + (titleText || this.untitled);
		if (navigator.mediaSession.metadata) navigator.mediaSession.metadata.title = titleText || this.untitled;
	}

	set #tempo(value) {
		this.tempoSlider.value = value;
		this.tempoValue.textContent = value;
	}

	#presetsUpdated({ presets, index }) {
		if (presets !== undefined) {
			const { lastModified, values } = presets;
			this.presetsSelect.options.length = 0;
			this.presetsSelect.append(...values.map(({ name, value }) => new Option(name || this.untitled, value)));
			this.presetsDate.dateTime = lastModified?.toJSON() ?? '';
		}
		if (index !== undefined) this.presetsSelect.selectedIndex = index;
	}

	getStepIndex(step) {
		const beat  = step.closest(this.#selectors.beat);
		const bar   = beat.closest(this.#selectors.bar);
		const track = bar.closest(this.#selectors.track);

		return (track.dataset.index | 0) * this.#resolution.track
			 + (bar.dataset.index   | 0) * this.#resolution.bar
			 + (beat.dataset.index  | 0) * this.#resolution.beat
			 + (step.dataset.index  | 0);
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

	get tempoValue()    { return this.#nodes.tempoValue    ??= document.querySelector(this.#selectors.tempoValue); }
	get tempoSlider()   { return this.#nodes.tempoSlider   ??= document.querySelector(this.#selectors.tempoSlider); }
	get sequenceTitle() { return this.#nodes.sequenceTitle ??= document.querySelector(this.#selectors.sequenceTitle); }
	get presetsSelect() { return this.#nodes.presetsSelect ??= document.querySelector(this.#selectors.presetsSelect); }
	get container()     { return this.#nodes.container     ??= document.querySelector(this.#selectors.container); }
	get startButton()   { return this.#nodes.startButton   ??= document.querySelector(this.#selectors.startButton); }
	get trackList()     { return this.#nodes.trackList     ??= document.querySelector(this.#selectors.trackList); }
	get trackTemplate() { return this.#nodes.trackTemplate ??= document.querySelector(this.#selectors.trackTemplate).content.querySelector(this.#selectors.track); }
	get presetsDate()   { return this.#nodes.presetsDate   ??= document.querySelector(this.#selectors.presetsDate); }
	get untitled()      { return this.#untitled            ??= document.querySelector(this.#selectors.untitledLabel).textContent; }

	get swap()          { return this.#instances.swap; }
	get dialogs()       { return this.#instances.dialogs; }
}