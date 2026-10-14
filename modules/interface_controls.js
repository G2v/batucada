export default class InterfaceControls {
	static #inheritedTrackKeys = Object.freeze(['beats', 'steps']);

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
	#positionSelect;
	#deleteCheckbox;
	#presetsMenuButton;
	#trackPositionText;
	#trackSettingsDialog;
	#controlsSection;

	constructor({ bus, parent, config }) {
		this.#ui                = parent;
		this.#bus               = bus;
		this.#names             = config.names;
		this.#events            = config.events;

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
		this.#deleteCheckbox      = document.querySelector(selectors.deleteCheckbox);
		this.#controlsSection     = document.querySelector(selectors.controlsSection);

		const options = Array.from({ length: config.tracksLength - 1 }, (_, i) => new Option(i + 2, i + 1));
		this.#positionSelect.firstElementChild.after(...options);

		document.addEventListener('click',                       (event) => this.#handleClick(event));
		document.addEventListener('click',                       (event) => this.#userGesture(), { once: true });
		this.#ui.container.addEventListener('input',             (event) => this.#handleInput(event));
		this.#ui.container.addEventListener('change',            (event) => this.#handleChange(event));
		this.#deleteCheckbox.addEventListener('change',          () => this.#toggleFields());
		this.#trackSettingsDialog.addEventListener('submit',     (event) => this.#setTrack());
		this.#trackSettingsDialog.addEventListener('command',    (event) => this.#showTrackSettings(event));
		this.#initMediaSession();
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

		if (this.#deleteCheckbox.checked) {
			this.#ui.swap.trashTrack(trackIndex);
			return;
		}

		const newPosition = parseInt(this.#positionSelect.value);
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
		const isMoved = newPosition !== currentPosition;
		const targetIndex = newPosition > currentPosition
			? order[newPosition + 1] ?? null
			: order[newPosition];
		if (!hasChanges && !isMoved) return;

		this.#ui.startViewTransition(() => {
			if (isMoved) this.#ui.swap.moveTrack(trackIndex, targetIndex);
			if (hasChanges) Object.assign(values, changes);
		}, isMoved ? this.#track : null);

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
		const { bars, beats, steps, phrase } = track.dataset;
		const index       = this.#ui.getTrackIndex(track);
		const order       = this.#ui.tracksOrder;
		const position    = order.indexOf(index);
		const isLastTrack = this.#ui.isTrackEmpty(track);
		const firstEmpty  = order.findIndex(trackIndex => this.#ui.isTrackEmpty(this.#ui.tracks[trackIndex]));
		const filledCount = firstEmpty === -1 ? order.length : firstEmpty;

		for (const option of this.#positionSelect.options) {
			const value = option.value | 0;
			option.hidden = isLastTrack ? value !== position : value >= filledCount;
		}

		this.#track                         = track;
		this.#trackPositionText.textContent = position + 1;
		this.#barsSelect.value              = bars;
		this.#beatsSelect.value             = beats;
		this.#stepsSelect.value             = steps;
		this.#phraseSelect.value            = phrase;
		this.#positionSelect.value          = position;
		this.#deleteCheckbox.checked        = false;
		this.#toggleFields();
	}

	#toggleFields() {
		const disabled = this.#deleteCheckbox.checked;
		for (const select of [this.#barsSelect, this.#beatsSelect, this.#stepsSelect, this.#phraseSelect, this.#positionSelect]) {
			select.disabled = disabled;
		}
	}

	#inputInstrument(target) {
		const value     = Number(target.value);
		const track     = this.#ui.getTrack(target);
		const index     = this.#ui.getTrackIndex(track);
		const tracks    = [{ id: index, changes: { instrument: value } }];
		const nextTrack = this.#ui.isTrackEmpty(track) ? track.nextElementSibling : null;
		const inherited = nextTrack && this.#ui.isTrackEmpty(nextTrack) ? this.#inheritedChanges(track, nextTrack) : null;
		if (inherited) {
			tracks.push({ id: this.#ui.getTrackIndex(nextTrack), changes: inherited });
			Object.assign(nextTrack.dataset, inherited);
		}
		this.#ui.startViewTransition(() => track.dataset.instrument = value);
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail: { tracks } }));
	}

	#inheritedChanges(source, target) {
		const changes = {};
		for (const key of InterfaceControls.#inheritedTrackKeys) {
			if (source.dataset[key] !== target.dataset[key]) changes[key] = Number(source.dataset[key]);
		}
		return Object.keys(changes).length ? changes : null;
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
		const detail = { tempo: Number(target.value) };
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail }));
	}

	#start(state = !this.#ui.playing) {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceUpdateData, { detail: { playing: state } }));
	}

	#changeTheme() {
		const isDark = !document.documentElement.classList.contains('dark');
		localStorage.theme = isDark ? 'dark' : 'light';
		document.startViewTransition(window.applyTheme);
	}

	#skipContent(event) {
		event.preventDefault();
		this.#controlsSection.focus({ preventScroll: true });
		this.#controlsSection.scrollIntoView({ behavior: 'smooth' });
	}
}
