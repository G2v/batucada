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
		bpm:           '#combo_tempo span',
		title:         '#title',
		tempo:         '#combo_tempo input',
		presets:       '#combo_presets select',
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
			this.#buildDom();
			this.#buildCSS();
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
		const fragment = new DocumentFragment();
		const masterTrack = this.trackTemplate.cloneNode(true);
		const masterSelect = masterTrack.querySelector(this.#selectors.instrument);
		const options = instrumentsLibrary.instruments.slice(1).map(({ name, id }) => new Option(name, id));
		masterSelect.append(...options);

		const firstBar = masterTrack.querySelector(this.#selectors.bar);
		const firstBeat = firstBar.querySelector(this.#selectors.beat);
		const barLabelTemplate = firstBar.ariaLabel.slice(0, -1);
		const beatLabelTemplate = firstBeat.ariaLabel.slice(0, -1);
		this.#cleanTemplates(firstBar);

		for (let beat = 1; beat < this.#resolution.maxBeats; beat++) {
			const beatClone = firstBeat.cloneNode(true);
			beatClone.dataset.index = beat;
			beatClone.ariaLabel = `${beatLabelTemplate}${beat + 1}`;
			firstBar.appendChild(beatClone);
		}

		for (let bar = 1; bar < this.#resolution.maxBars; bar++) {
			const barClone = firstBar.cloneNode(true);
			barClone.dataset.index = bar;
			barClone.ariaLabel = `${barLabelTemplate}${bar + 1}`;
			firstBar.parentNode.appendChild(barClone);
		}

		this.#cleanTemplates(masterTrack);

		for (let i = 0; i < app_config.tracksLength; i++) {
			const trackClone = masterTrack.cloneNode(true);
			trackClone.dataset.index = i;
			const instrumentSelect = trackClone.querySelector(this.#selectors.instrument);
			instrumentSelect.value = this.#config.defaultInstrument;
			this.#nodes.tracks.push(trackClone);
			this.#nodes.instruments.push(instrumentSelect);
			this.#nodes.volumes.push(trackClone.querySelector(this.#selectors.volume));
			const steps = trackClone.querySelectorAll(this.#selectors.step);
			steps[0].tabIndex = 0;
			this.#nodes.steps.push(...steps);
			fragment.appendChild(trackClone);
		}

		this.trackParent.appendChild(fragment);
		this.#tracksOrder = Array.from({ length: app_config.tracksLength }, (_, i) => i);
		this.#resolvers.dom();
	}

	#cleanTemplates(item) {
		const elements = item.hasAttribute('data-template') ? [item, ...item.querySelectorAll('[data-template]')] : item.querySelectorAll('[data-template]');
		for (const element of elements) {
			for (const key in element.dataset) {
				if (key.startsWith('template')) {
					delete element.dataset[key];
				}
			}
		}
	}

	#buildCSS() {
		const [first, ...rest] = instrumentsLibrary.instruments;
		let rules = `[data-instrument] [name="step"]:not([value="0"]) { --current-icon: url('${first.strokes[0]}') }`;
		for (const { id, strokes } of rest) {
			for (let j = 0; j < strokes.length; j++) {
				rules += `[data-instrument="${id}"] [name="step"][value="${j + 1}"] { --current-icon: url('${strokes[j]}') }`;
			}
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
		this.title.textContent = value;
		navigator.mediaSession.metadata.title = value || this.untitled;
		document.title = this.#headTitlePrefix + (value || this.untitled);
	}

	set #tempo(value) {
		this.tempo.value = value;
		this.bpm.textContent = value;
	}

	set #presets({ lastModified, values }) {
		this.#presetsDate = lastModified;
		const fragment = new DocumentFragment();
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

		this.#removePlaceholders({ title, presets });

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

	#removePlaceholders(items) {
		const placeholders = window.placeholders;
		if (!placeholders) return;
		requestAnimationFrame(() => {
			const root = document.documentElement;
			for (const item in placeholders) {
				if (items[item] !== undefined) {
					root.style.removeProperty(placeholders[item]);
					delete placeholders[item];
				}
			}
			if (Object.keys(placeholders).length === 0) {
				root.removeAttribute('style');
				delete window.placeholders;
			}
		});
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

	set playing(status) {
		this.#playing = status;
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
	get appTitle()      { return this.#nodes.appTitle      ??= document.querySelector(this.#selectors.appTitle).textContent; }
	get untitled()      { return this.#nodes.untitled      ??= document.querySelector(this.#selectors.untitled).textContent; }
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

}
