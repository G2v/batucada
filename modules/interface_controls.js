export default class InterfaceControls {
	#ui;
	#audio;
	#song;
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
	#trackPositionText;
	#trackSettingsDialog;
	#savedSongsMenuButton;
	#controlsSection;

	#wakeLock = null;

	constructor({ parent, config, song, audio }) {
		this.#ui    = parent;
		this.#audio = audio;
		this.#song  = song;
		this.#names = config.names;

		const { selectors } = config;

		this.#appTitle             = document.querySelector(selectors.appTitle);
		this.#barsSelect           = document.querySelector(selectors.barsSelect);
		this.#beatsSelect          = document.querySelector(selectors.beatsSelect);
		this.#stepsSelect          = document.querySelector(selectors.stepsSelect);
		this.#phraseSelect         = document.querySelector(selectors.phraseSelect);
		this.#skipButton           = document.querySelector(selectors.skipButton);
		this.#themeButton          = document.querySelector(selectors.themeButton);
		this.#resetButton          = document.querySelector(selectors.resetButton);
		this.#savedSongsMenuButton = document.querySelector(selectors.savedSongsMenuButton);
		this.#trackSettingsDialog  = document.querySelector(selectors.trackSettingsDialog);
		this.#trackPositionText    = document.querySelector(selectors.trackPositionText);
		this.#positionSelect       = document.querySelector(selectors.positionSelect);
		this.#deleteCheckbox       = document.querySelector(selectors.deleteCheckbox);
		this.#controlsSection      = document.querySelector(selectors.controlsSection);

		const options = Array.from({ length: config.tracksLength - 1 }, (_, i) => new Option(i + 2, i + 1));
		this.#positionSelect.firstElementChild.after(...options);

		document.addEventListener('click',                    (event) => this.#handleClick(event));
		document.addEventListener('click',                    () => this.#audio.unlock(), { once: true });
		document.addEventListener('visibilitychange',         () => this.#wakeLockRequest());
		audio.addEventListener('play',                        () => this.#playbackChanged(true));
		audio.addEventListener('stop',                        () => this.#playbackChanged(false));
		song.addEventListener('change',                       ({ detail }) => detail.title && this.#renderMediaTitle());
		this.#ui.container.addEventListener('input',          (event) => this.#handleInput(event));
		this.#ui.container.addEventListener('change',         (event) => this.#handleChange(event));
		this.#deleteCheckbox.addEventListener('change',       () => this.#toggleFields());
		this.#trackSettingsDialog.addEventListener('submit',  () => this.#setTrack());
		this.#trackSettingsDialog.addEventListener('command', (event) => this.#showTrackSettings(event));
		this.#initMediaSession();
	}

	#initMediaSession() {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.#mediaTitle,
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

		const { order, tracks } = this.#song;
		const newPosition = this.#positionSelect.value | 0;
		const fields = {
			bars:   this.#barsSelect.value,
			beats:  this.#beatsSelect.value,
			steps:  this.#stepsSelect.value,
			phrase: this.#phraseSelect.value,
		};
		const changes = {};
		for (const [key, newValue] of Object.entries(fields)) {
			if (tracks[trackIndex][key] !== Number(newValue)) changes[key] = Number(newValue);
		}
		const hasChanges  = Object.keys(changes).length > 0;
		const currentPosition = order.indexOf(trackIndex);
		const isMoved = newPosition !== currentPosition;
		const targetIndex = newPosition > currentPosition
			? order[newPosition + 1] ?? null
			: order[newPosition];
		if (!hasChanges && !isMoved) return;

		this.#ui.startViewTransition(() => {
			if (isMoved) this.#song.moveTrack(trackIndex, targetIndex);
			if (hasChanges) this.#song.setTrack(trackIndex, changes);
		}, isMoved ? this.#track : null);
	}

	#handleClick(event) {
		const { target } = event;
		if (target.name === this.#names.step) {
			this.#changeNote(target);
		}
		else if (target === this.#resetButton) {
			this.#song.reset();
		}
		else if (target === this.#ui.startButton) {
			this.#start();
		}
		else if (target === this.#savedSongsMenuButton) {
			this.#ui.dialogs.showToast(target.dataset.message);
		}
		else if (target === this.#themeButton) {
			this.#changeTheme();
		}
		else if (target === this.#skipButton) {
			this.#skipContent(event);
		}
	}

	#handleChange({ target }) {
		this.#setSlider(target, false);
	}

	#handleInput({ target }) {
		if (target.name === this.#names.instrument) {
			this.#inputInstrument(target);
		}
		else {
			this.#setSlider(target, true);
		}
	}

	#setSlider(target, transient) {
		const value = Number(target.value);
		if (target === this.#ui.tempoSlider) {
			this.#song.setTempo(value, { transient });
		}
		else if (target.name === this.#names.volume) {
			this.#song.setVolume(this.#ui.getTrackIndex(this.#ui.getTrack(target)), value, { transient });
		}
	}

	#changeNote(target) {
		const index  = this.#ui.getStepIndex(target);
		const stroke = this.#song.toggleStroke(index);
		this.#audio.preview(index, stroke);
	}

	#showTrackSettings({ command, source }) {
		if (command !== 'show-modal') return;
		const track       = this.#ui.getTrack(source);
		const index       = this.#ui.getTrackIndex(track);
		const { order }   = this.#song;
		const { bars, beats, steps, phrase } = this.#song.tracks[index];
		const position    = order.indexOf(index);
		const isLastTrack = this.#song.isEmpty(index);
		const tracks      = this.#song.activeTracks;
		const filledCount = tracks.length - (this.#song.isEmpty(tracks.at(-1)) ? 1 : 0);

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
		const index      = this.#ui.getTrackIndex(this.#ui.getTrack(target));
		const instrument = Number(target.value);
		this.#ui.startViewTransition(() => this.#song.setTrack(index, { instrument }));
	}

	#start(state = !this.#audio.playing) {
		if (state) this.#audio.play();
		else this.#audio.stop();
	}

	#playbackChanged(playing) {
		this.#ui.startButton.ariaChecked = playing;
		navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
		if (playing) this.#wakeLockRequest();
		else this.#wakeLockRelease();
	}

	async #wakeLockRequest() {
		if (!this.#audio.playing || document.hidden) return;
		try {
			const wakeLock = await navigator.wakeLock.request();
			this.#wakeLockRelease();
			if (this.#audio.playing && !document.hidden) this.#wakeLock = wakeLock;
			else wakeLock.release().catch(() => {});
		} catch {}
	}

	#wakeLockRelease() {
		this.#wakeLock?.release().catch(() => {});
		this.#wakeLock = null;
	}

	#renderMediaTitle() {
		navigator.mediaSession.metadata.title = this.#mediaTitle;
	}

	get #mediaTitle() {
		return this.#song.title || this.#ui.untitled;
	}

	#changeTheme() {
		const isDark = !document.documentElement.classList.contains('dark');
		localStorage.theme = isDark ? 'dark' : 'light';
		document.startViewTransition(window.applyTheme);
	}

	#skipContent(event) {
		event.preventDefault();
		this.#controlsSection.tabIndex = -1;
		this.#controlsSection.addEventListener('blur', ({ target }) => target.removeAttribute('tabindex'), { once: true });
		this.#controlsSection.focus({ preventScroll: true });
		this.#controlsSection.scrollIntoView({ behavior: 'smooth' });
	}
}
