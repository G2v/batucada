import { buildStyles, buildTracks, fillInstruments } from './build-dom.js';

export class Interface {
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

	#untitled;
	#selectors;
	#resolution;
	#instrumentKey;
	#trackProperties;

	#nodes           = {};
	#ready           = {};
	#resolvers       = {};
	#instances       = {};
	#playing         = false;
	#presetsDate     = null;
	#headTitlePrefix = `${document.title} - `;

	constructor({ bus, config, initial = {} }) {
		const events             = config.events;
		this.#selectors          = config.selectors;
		this.#resolution         = config.resolution;
		this.#instrumentKey      = config.trackKeys.instrument;
		this.#trackProperties    = new Set(Object.values(config.trackKeys));

		Interface.#modules.forEach(({ name }) => {
			this.#ready[name] = new Promise(resolve => this.#resolvers[name] = resolve);
		});

		bus.addEventListener(events.audioStop,            ({ detail }) => this.#instances.animation?.stop());
		bus.addEventListener(events.audioUpdateData,      ({ detail }) => this.#update(detail));
		bus.addEventListener(events.audioPushAnimations,  ({ detail }) => this.#instances.animation?.start(detail));
		bus.addEventListener(events.presetsUpdateData,    ({ detail }) => this.#update(detail));
		bus.addEventListener(events.presetsInvalidName,   ({ detail }) => this.#instances.presets?.reportNameValidity(detail));
		bus.addEventListener(events.swClientNewVersion,   ({ detail }) => this.#instances.app?.showUpdateButton(detail));
		bus.addEventListener(events.navigationDecoded,    ({ detail }) => this.#update(detail));
		bus.addEventListener(events.navigationCloseModal, ({ detail }) => this.#instances.dialogs?.closeModal(detail));

		this.#build({ bus, config, initial });
	}

	#build(params) {
		const { config, initial } = params;

		buildStyles(config);

		const { nodes, fragment } = buildTracks(config, this.trackTemplate);
		Object.assign(this.#nodes, nodes);

		if (initial.title === undefined) document.title = this.#headTitlePrefix + this.untitled;
		this.#apply(initial);
		this.trackList.appendChild(fragment);
		document.documentElement.style.removeProperty('--untitled');
		document.documentElement.style.removeProperty('--tracks-count');
		fillInstruments(config, this.#nodes);

		this.#loadModules(params);
	}

	#loadModules(params) {
		Interface.#modules.forEach(({ name, path }) => {
			import(path).then(module => {
				this.#instances[name] = new module.default({ ...params, parent: this });
				this.#resolvers[name]();
			});
		});
	}

	set #tracks(values) {
		for (const { id, changes } of values) {
			const trackData = this.#nodes.tracks[id].dataset;
			for (const [item, value] of Object.entries(changes)) {
				if (!this.#trackProperties.has(item)) continue;
				trackData[item] = value;
				if (item === this.#instrumentKey) {
					this.#nodes.instruments[id].value = value;
				}
			}
		}
	}

	set #sheet(values) {
		for (const { stepIndex, value } of values) {
			this.#nodes.steps[stepIndex].value = value;
		}
	}

	set #volumes(values) {
		for (const { id, value } of values) {
			this.#nodes.volumes[id].value = value;
		}
	}

	set #title(value) {
		const titleText = value.replace(/[\s\p{Z}\u200B-\u200D\uFEFF]+/gu, ' ').trim();
		this.sequenceTitle.textContent = titleText;
		document.title = this.#headTitlePrefix + (titleText || this.untitled);
	}

	set #tempo(value) {
		this.tempoSlider.value = value;
		this.tempoValue.textContent = value;
	}

	set #presets({ lastModified, values }) {
		this.#presetsDate = lastModified;
		const fragment = new DocumentFragment();
		fragment.appendChild(this.presetsSelect.firstElementChild);
		values.forEach(({ name, value }) => fragment.appendChild(new Option(name || this.untitled, value)));
		this.presetsSelect.replaceChildren(fragment);
	}

	set #index(index) {
		this.presetsSelect.selectedIndex = index;
	}

	#apply({ tempo, title, sheet, tracks, volumes, presets, index }) {
		if (tempo   !== undefined) this.#tempo   = tempo;
		if (title   !== undefined) this.#title   = title;
		if (sheet   !== undefined) this.#sheet   = sheet;
		if (tracks  !== undefined) this.#tracks  = tracks;
		if (volumes !== undefined) this.#volumes = volumes;
		if (presets !== undefined) this.#presets = presets;
		if (index   !== undefined) this.#index   = index;
	}

	async #updateAria({ tempo, title, sheet, tracks, volumes }) {
		if (
			tempo   === undefined &&
			title   === undefined &&
			sheet   === undefined &&
			tracks  === undefined &&
			volumes === undefined
		) return;

		await this.#ready.aria;
		this.#instances.aria.update({ tempo, sheet, tracks, volumes });
	}

	#update(changes) {
		this.#apply(changes);
		this.#updateAria(changes);
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

	getTrack(child)      { return child.closest(this.#selectors.track); }

	getTrackIndex(track) { return track.dataset.index | 0; }

	getTrackInstrument(track) { return track.dataset[this.#instrumentKey] | 0; }

	startViewTransition(callback) {
		document.documentElement.dataset.transitioning = '';
		document.startViewTransition(callback)
			.finished.finally(() => delete document.documentElement.dataset.transitioning);
	}

	set playing(status) {
		this.#playing = status;
		if (status) {
			navigator.mediaSession.metadata.title = (this.sequenceTitle.textContent || this.untitled);
		}
		navigator.mediaSession.playbackState = status ? 'playing' : 'paused';
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
	get untitled()      { return this.#untitled            ??= document.querySelector(this.#selectors.untitledLabel).textContent; }

	get swap()          { return this.#instances.swap; }
	get playing()       { return this.#playing; }
	get dialogs()       { return this.#instances.dialogs; }
	get presetsDate()   { return this.#presetsDate; }
	get tracksOrder()   { return [...this.trackList.children].map(track => track.dataset.index | 0); }
}