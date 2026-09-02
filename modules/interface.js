import app_config  from '../config/app.js';
import core_config from '../config/core.js';

const instrumentsLibrary = await (async () => {
	const url = new URL(core_config.instrumentsMetadataFile, location.href).href;
	const cache = await caches.open(core_config.dataCache);
	const cached = await cache.match(url);
	if (cached) return cached.json();
	const response = await fetch(url);
	return response.json();
})();

export class Interface {
	#names = Object.freeze({
		step:       'step',
		volume:     'volume',
		instrument: 'instrument',
	});

	#trackKeys = Object.freeze({
		bars:       'bars',
		beats:      'beats',
		steps:      'steps',
		phrase:     'phrase',
		instrument: 'instrument',
	});

	#trackProperties = new Set(Object.values(this.#trackKeys));

	#selectors = Object.freeze({
		bar:           '.bar',
		beat:          '.beat',
		track:         '.track',
		step:          '[name="step"]',
		volume:        '[name="volume"]',
		instrument:    '[name="instrument"]',
		setBars:       '#bars',
		setBeats:      '#beats',
		setSteps:      '#steps',
		setPhrase:     '#phrase',
		bpm:           '#tempo span',
		title:         '#title',
		tempo:         '#tempo input',
		presets:       '#preset select',
		appTitle:      '#app-title',
		untitled:      '#untitled',
		container:     'main',
		startButton:   '#start',
		themeButton:   '#theme',
		trackParent:   'tbody',
		trackTemplate: 'template',
	});

	#modules = Object.freeze([
		{ name: 'controls',    path: './interface_controls.js' },
		{ name: 'dialogs',     path: './interface_dialogs.js' },
		{ name: 'animation',   path: './interface_animation.js' },
		{ name: 'presets',     path: './interface_presets.js' },
		{ name: 'instruments', path: './interface_instruments.js' },
		{ name: 'aria',        path: './interface_aria.js' },
		{ name: 'swap',        path: './interface_swap.js' },
		{ name: 'app',         path: './interface_app.js' },
	]);

	#bus;
	#tracksOrder;

	#config;
	#untitled;
	#resolution;

	#nodes           = {};
	#ready           = {};
	#resolvers       = {};
	#instances       = {};
	#playing         = false;
	#presetsDate     = null;
	#headTitlePrefix = `${document.title} - `;

	constructor({ bus }) {
		this.#bus = bus;
		this.#initConfig();

		this.#ready.dom = new Promise(resolve => this.#resolvers.dom = resolve);
		this.#modules.forEach(({ name }) => {
			this.#ready[name] = new Promise(resolve => this.#resolvers[name] = resolve);
		});

		this.#bus.addEventListener('audio:stop',            ({ detail }) => this.#instances.animation?.stop());
		this.#bus.addEventListener('audio:updateData',      ({ detail }) => this.#update(detail));
		this.#bus.addEventListener('audio:pushAnimations',  ({ detail }) => this.#instances.animation?.start(detail));
		this.#bus.addEventListener('presets:updateData',    ({ detail }) => this.#update(detail));
		this.#bus.addEventListener('presets:invalidName',   ({ detail }) => this.#instances.presets?.reportNameValidity(detail));
		this.#bus.addEventListener('sw-client:newVersion',  ({ detail }) => this.#instances.app?.showUpdateButton(detail));
		this.#bus.addEventListener('navigation:decoded',    ({ detail }) => this.#update(detail));
		this.#bus.addEventListener('navigation:closeModal', ({ detail }) => this.#instances.controls?.closeModal(detail));

		queueMicrotask(async () => {
			this.#buildCSS();
			this.#buildDom();
			this.#loadModules();
		});
	}

	#initConfig() {
		const getOptionsValues = (node) => Array.from(node.options, option => option.value | 0);

		const barsValues   = getOptionsValues(this.setBars);
		const beatsValues  = getOptionsValues(this.setBeats);
		const stepsValues  = getOptionsValues(this.setSteps);
		const phraseValues = getOptionsValues(this.setPhrase);

		const maxBars   = Math.max(...barsValues);
		const maxBeats  = Math.max(...beatsValues);
		const maxSteps  = Math.max(...stepsValues);
		const maxPhrase = Math.max(...phraseValues);

		this.#resolution = {
			beat:  maxSteps,
			bar:   maxSteps * maxBeats,
			track: maxSteps * maxBeats * maxBars,
			maxBars,
			maxBeats,
		};

		const { bars, beats, steps, phrase, instrument } = this.trackTemplate.dataset;
		const volumeReference = this.trackTemplate.querySelector(this.#selectors.volume);

		this.#config = Object.freeze({
			...app_config,
			...core_config,
			emptyStroke:       0,
			resolution:        this.#resolution,
			maxGain:           volumeReference.max | 0,
			defaultTempo:      this.tempo.value | 0,
			defaultGain:       volumeReference.value | 0,
			defaultBars:       bars | 0,
			defaultBeats:      beats | 0,
			defaultSteps:      steps | 0,
			defaultPhrase:     phrase | 0,
			defaultInstrument: instrument | 0,
			defaultOrder:      Array.from({ length: app_config.tracksLength }, (_, i) => i),
			barsValues, stepsValues, beatsValues, phraseValues, maxPhrase, instrumentsLibrary,
		});

		this.#nodes.tracks = [];
		this.#nodes.instruments = [];
		this.#nodes.volumes = [];
		this.#nodes.steps = [];
	}

	#buildDom() {
		document.title = this.#headTitlePrefix + this.untitled;

		const { tracksLength, defaultInstrument, defaultOrder } = this.#config;
		const masterTrack = this.trackTemplate.cloneNode(true);
		const firstBar    = masterTrack.querySelector(this.#selectors.bar);
		const firstBeat   = firstBar.querySelector(this.#selectors.beat);

		masterTrack.querySelector(this.#selectors.instrument).append(
			...instrumentsLibrary.instruments.slice(1).map(({ name, id }) => new Option(name, id))
		);

		this.#cleanTemplates(firstBar);
		Interface.#cloneIndexed(firstBeat, this.#resolution.maxBeats, firstBar);
		Interface.#cloneIndexed(firstBar, this.#resolution.maxBars, firstBar.parentNode);
		this.#cleanTemplates(masterTrack);

		const fragment = new DocumentFragment();

		for (let index = 0; index < tracksLength; index++) {
			const track  = masterTrack.cloneNode(true);
			const select = track.querySelector(this.#selectors.instrument);
			const steps  = track.querySelectorAll(this.#selectors.step);

			track.dataset.index = index;
			select.value = defaultInstrument;
			steps[0].tabIndex = 0;

			this.#nodes.tracks.push(track);
			this.#nodes.instruments.push(select);
			this.#nodes.volumes.push(track.querySelector(this.#selectors.volume));
			this.#nodes.steps.push(...steps);
			fragment.appendChild(track);
		}

		this.trackParent.appendChild(fragment);
		this.#tracksOrder = [...defaultOrder];
		this.#resolvers.dom();
	}

	static #cloneIndexed(node, count, parent) {
		const label = node.ariaLabel.replace(/\s*\d+$/, '');
		for (let index = 1; index < count; index++) {
			const clone = node.cloneNode(true);
			clone.dataset.index = index;
			clone.ariaLabel = `${label} ${index + 1}`;
			parent.appendChild(clone);
		}
	}

	#cleanTemplates(root) {
		for (const element of [root, ...root.querySelectorAll('[data-template]')]) {
			for (const key in element.dataset) {
				if (key.startsWith('template')) delete element.dataset[key];
			}
		}
	}

	#buildCSS() {
		const [first, ...rest] = instrumentsLibrary.instruments;
		let rules = `[data-instrument] { --icon-default: url('${first.strokes[0].icon}') }`;
		let maxStrokes = 0;
		for (const { id, strokes } of rest) {
			maxStrokes = Math.max(maxStrokes, strokes.length);
			const icons = strokes.map(({ icon }, j) => `--icon-${j + 1}: url('${icon}')`).join('; ');
			rules += `[data-instrument="${id}"] { ${icons} }`;
		}
 		for (let j = 1; j <= maxStrokes; j++) {
			rules += `[name="step"][value="${j}"] { --current-icon: var(--icon-${j}, var(--icon-default)) }`;
		}
		const stylesheet = new CSSStyleSheet();
		stylesheet.replaceSync(rules);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
	}

	#loadModules() {
		this.#modules.forEach(({ name, path }) => {
			import(path).then(module => {
				this.#instances[name] = new module.default({ bus: this.#bus, parent: this });
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
				if (item === this.#trackKeys.instrument) {
					this.#nodes.instruments[id].value = value;
				}
			}
		}
		document.documentElement.style.removeProperty('--tracks-count');
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
		this.title.textContent = titleText;
		document.title = this.#headTitlePrefix + (titleText || this.untitled);
	}

	set #tempo(value) {
		this.tempo.value = value;
		this.bpm.textContent = value;
	}

	set #presets({ lastModified, values }) {
		this.#presetsDate = lastModified;
		const fragment = new DocumentFragment();
		fragment.appendChild(this.presets.firstElementChild);
		values.forEach(({ name, value }) => fragment.appendChild(new Option(name || this.untitled, value)));
		this.presets.replaceChildren(fragment);
	}

	set #index(index) {
		this.presets.selectedIndex = index;
	}

	async #update({ tempo, title, sheet, tracks, volumes, presets, index }) {
		await this.#ready.dom;
		if (tempo   !== undefined) this.#tempo   = tempo;
		if (title   !== undefined) this.#title   = title;
		if (sheet   !== undefined) this.#sheet   = sheet;
		if (tracks  !== undefined) this.#tracks  = tracks;
		if (volumes !== undefined) this.#volumes = volumes;
		if (presets !== undefined) this.#presets = presets;
		if (index   !== undefined) this.#index   = index;

		if (
			tempo   !== undefined ||
			title   !== undefined ||
			sheet   !== undefined ||
			tracks  !== undefined ||
			volumes !== undefined
		) {
			await this.#ready.aria;
			this.#instances.aria.update({ tempo, sheet, tracks, volumes });
		}
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

	getTrackInstrument(track) { return track.dataset[this.#trackKeys.instrument] | 0; }

	startViewTransition(callback) {
		document.documentElement.dataset.transitioning = '';
		document.startViewTransition(callback)
			.finished.finally(() => delete document.documentElement.dataset.transitioning);
	}

	set playing(status) {
		this.#playing = status;
		if (status) {
			navigator.mediaSession.metadata.title = (this.title.textContent || this.untitled);
		}
		navigator.mediaSession.playbackState = status ? 'playing' : 'paused';
	}

	get steps()         { return this.#nodes.steps; }
	get tracks()        { return this.#nodes.tracks; }
	get volumes()       { return this.#nodes.volumes; }
	get instruments()   { return this.#nodes.instruments; }
	get bpm()           { return this.#nodes.bpm           ??= document.querySelector(this.#selectors.bpm); }
	get title()         { return this.#nodes.title         ??= document.querySelector(this.#selectors.title); }
	get tempo()         { return this.#nodes.tempo         ??= document.querySelector(this.#selectors.tempo); }
	get presets()       { return this.#nodes.presets       ??= document.querySelector(this.#selectors.presets); }
	get setBars()       { return this.#nodes.setBars       ??= document.querySelector(this.#selectors.setBars); }
	get setSteps()      { return this.#nodes.setSteps      ??= document.querySelector(this.#selectors.setSteps); }
	get setBeats()      { return this.#nodes.setBeats      ??= document.querySelector(this.#selectors.setBeats); }
	get setPhrase()     { return this.#nodes.setPhrase     ??= document.querySelector(this.#selectors.setPhrase); }

	get container()     { return this.#nodes.container     ??= document.querySelector(this.#selectors.container); }
	get startButton()   { return this.#nodes.startButton   ??= document.querySelector(this.#selectors.startButton); }
	get themeButton()   { return this.#nodes.themeButton   ??= document.querySelector(this.#selectors.themeButton); }
	get trackParent()   { return this.#nodes.trackParent   ??= document.querySelector(this.#selectors.trackParent); }
	get trackTemplate() { return this.#nodes.trackTemplate ??= document.querySelector(this.#selectors.trackTemplate).content.querySelector(this.#selectors.track); }

	get swap()          { return this.#instances.swap; }
	get names()         { return this.#names; }
	get config()        { return this.#config; }
	get playing()       { return this.#playing; }
	get dialogs()       { return this.#instances.dialogs; }
	get selectors()     { return this.#selectors; }
	get presetsDate()   { return this.#presetsDate; }
	get tracksOrder()   { return this.#tracksOrder; }
	get untitled()      { return this.#untitled ??= document.querySelector(this.#selectors.untitled).textContent; }
}
