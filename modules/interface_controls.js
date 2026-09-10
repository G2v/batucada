
export default class InterfaceControls {
	#ui;
	#bus;
	#events;
	#track;
	#names;
	#appTitle;
	#barsSelect;
	#beatsSelect;
	#stepsSelect;
	#phraseSelect;
	#skipButton;
	#themeButton;
	#resetButton;
	#presetsMenuButton;
	#trackSettingsDialog;
	#trackPositionText;
	#positionSelect;
	#systemColor;
	#controlsSection;
	#defaultInstrument;

	constructor({ bus, parent, config }) {
		this.#bus               = bus;
		this.#events            = config.events;
		this.#ui                = parent;
		this.#names             = config.names;
		this.#systemColor       = matchMedia('(prefers-color-scheme: dark)');
		this.#defaultInstrument = config.defaultInstrument;

		const { selectors } = config;

		this.#appTitle            = document.querySelector(selectors.appTitle);
		this.#barsSelect          = document.querySelector(selectors.barsSelect);
		this.#beatsSelect         = document.querySelector(selectors.beatsSelect);
		this.#stepsSelect         = document.querySelector(selectors.stepsSelect);
		this.#phraseSelect        = document.querySelector(selectors.phraseSelect);
		this.#skipButton          = document.querySelector(selectors.skipButton);
		this.#themeButton         = document.querySelector(selectors.themeButton);
		this.#resetButton         = document.querySelector(selectors.resetButton);
		this.#presetsMenuButton   = document.querySelector(selectors.presetsMenuButton);
		this.#trackSettingsDialog = document.querySelector(selectors.trackSettingsDialog);
		this.#trackPositionText   = document.querySelector(selectors.trackPositionText);
		this.#positionSelect      = document.querySelector(selectors.positionSelect);
		this.#controlsSection     = document.querySelector(selectors.controlsSection);

		const options = Array.from({ length: config.tracksLength - 1 }, (_, i) => new Option(i + 2, i + 1));
		this.#positionSelect.firstElementChild.after(...options);

		document.addEventListener('click',                       (event) => this.#handleClick(event));
		document.addEventListener('click',                       (event) => this.#userGesture(), { once: true });
		this.#ui.container.addEventListener('input',             (event) => this.#handleInput(event));
		this.#ui.container.addEventListener('change',            (event) => this.#handleChange(event));
		this.#trackSettingsDialog.addEventListener('submit',     (event) => this.#setTrack());
		this.#trackSettingsDialog.addEventListener('command',    (event) => this.#showTrackSettings(event));
		this.#systemColor.addEventListener('change',             (event) => this.#setTheme(event));
		this.#initMediaSession();

		if (!document.startViewTransition) {
			document.startViewTransition = (callback) => {
				callback();
				return { finished: Promise.resolve() };
			};
		}

		if (!('command' in HTMLButtonElement.prototype)) {
			import('./polyfills/invoker.js');
		}
	}

	#initMediaSession() {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.#ui.untitled,
			artist: this.#appTitle.textContent,
			artwork: [
				{
					src: './icons/icon_white-bg_512x512.png',
					sizes: '512x512',
					type: 'image/png',
				},
			],
		});
		navigator.mediaSession.setPositionState({ duration: 0 });
		navigator.mediaSession.setActionHandler('play',  () => this.#start(true));
		navigator.mediaSession.setActionHandler('pause', () => this.#start(false));
	}

	#setTrack() {
		const trackIndex = this.#ui.getTrackIndex(this.#track);
		const newPosition = parseInt(this.#positionSelect.value);

		if (newPosition === -1) {
			this.#ui.swap.trashTrack(trackIndex);
			return;
		}

		const values = this.#track.dataset;
		const fields = {
			bars:   this.#barsSelect.value,
			beats:  this.#beatsSelect.value,
			steps:  this.#stepsSelect.value,
			phrase: this.#phraseSelect.value,
		};
		const changes = {};
		for (const [key, newValue] of Object.entries(fields)) {
			if (values[key] !== newValue) changes[key] = Number(newValue);
		}
		const hasChanges  = Object.keys(changes).length > 0;
		const order = this.#ui.tracksOrder;
		const currentPosition = order.indexOf(trackIndex);
		const targetIndex = newPosition > -1 && newPosition !== currentPosition
			? (newPosition > currentPosition
				? order[newPosition + 1] ?? null
				: order[newPosition] ?? null)
			: null;
		if (!hasChanges && targetIndex === null) return;

		this.#ui.startViewTransition(() => {
			if (targetIndex !== null) this.#ui.swap.moveTrack(trackIndex, targetIndex);
			if (hasChanges) Object.assign(values, changes);
		});

		if (hasChanges) {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail: { tracks: [{ id: trackIndex, changes }] } }));
		}
	}

	#handleClick(event) {
		const { target } = event;
		if (target.name === this.#names.step) {
			this.#changeNote(target);
		}
		else if (target === this.#resetButton) {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceReset));
		}
		else if (target === this.#ui.startButton) {
			this.#start();
		}
		else if (target === this.#presetsMenuButton) {
			this.#ui.dialogs.showToast(target.dataset.message);
		}
		else if (target === this.#themeButton) {
			this.#changeTheme();
		}
		else if (target === this.#skipButton) {
			this.#skipContent(event);
		}
	}

	#userGesture() {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUserGesture));
	}

	#handleChange({ target }) {
		if (target === this.#ui.tempoSlider) {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceChange, { detail: 'tempo' }));
		} else if (target.name === this.#names.volume) {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceChange, { detail: 'volumes' }));
		}
	}

	#changeNote(target) {
		const change = { sheet: [{ stepIndex: this.#ui.getStepIndex(target), value: Number(target.value) }] };
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceSetStroke, { detail: change }));
	}

	#handleInput({ target }) {
		if (target.name === this.#names.instrument) {
			this.#inputInstrument(target);
		}
		else if (target.name === this.#names.volume) {
			this.#inputVolume(target);
		}
		else if (target === this.#ui.tempoSlider) {
			this.#inputTempo(target);
		}
	}

	#showTrackSettings({ command, source }) {
		if (command !== 'show-modal') return;
		const track = this.#ui.getTrack(source);
		const index = this.#ui.getTrackIndex(track);
		const { bars, beats, steps, phrase } = track.dataset;

		const order    = this.#ui.tracksOrder;
		const position = order.indexOf(index);
		const isLastTrack = this.#ui.getTrackInstrument(track) === this.#defaultInstrument;

		let option = this.#positionSelect.firstElementChild;
		let stop = false;
		while (option) {
			const trackIndex = order[option.value];
			if (trackIndex === undefined) break;
			const instrument = this.#ui.getTrackInstrument(this.#ui.tracks[trackIndex]);
			stop = stop || instrument === this.#defaultInstrument;
			option.hidden = isLastTrack ? (option.value | 0) !== position : stop;
			option = option.nextElementSibling;
		}

		this.#track = track;
		this.#trackPositionText.textContent = position + 1;
		this.#positionSelect.selectedIndex  = position;
		this.#barsSelect.value   = bars;
		this.#beatsSelect.value  = beats;
		this.#stepsSelect.value  = steps;
		this.#phraseSelect.value = phrase;
	}

	#inputInstrument(target) {
		const value = Number(target.value);
		const track = this.#ui.getTrack(target);
		const index = this.#ui.getTrackIndex(track);
		this.#ui.startViewTransition(() => track.dataset.instrument = value);
		const detail = { tracks: [ { id:index, changes: { instrument: value } } ] };
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail }));
	}

	#inputVolume(target) {
		const track = this.#ui.getTrack(target);
		const trackIndex = this.#ui.getTrackIndex(track);
		const value = Number(target.value);
		const detail = { volumes: [ { id:trackIndex, value } ] };
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail }));
	}

	#inputTempo(target) {
		this.#ui.tempoValue.textContent = target.value;
		const value = Number(target.value);
		const detail = { tempo: value };
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail }));
	}

	#start(state = !this.#ui.playing) {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail: { playing: state } }));
	}

	#changeTheme() {
		const theme = !document.documentElement.classList.contains('dark');
		if (theme === this.#systemColor.matches) {
			delete localStorage.theme;
		} else {
			localStorage.theme = theme ? 'dark' : 'light';
		}
		InterfaceControls.#applyTheme(theme);
	}

	#setTheme({ matches }) {
		if (localStorage.theme !== undefined) return;
		InterfaceControls.#applyTheme(matches);
	}

	static #applyTheme(theme) {
		document.startViewTransition(() => {
			document.documentElement.classList.toggle('dark', theme);
		});
	}

	#skipContent(event) {
		event.preventDefault();
		this.#controlsSection.focus({ preventScroll: true });
		this.#controlsSection.scrollIntoView({ behavior: 'smooth' });
	}
}
