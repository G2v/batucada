export default class InterfaceControls {
	#ui;
	#bus;
	#track;
	#systemColor;

	#controls         = document.querySelector('#controls');
	#skipButton       = document.querySelector('#skip');
	#resetButton      = document.querySelector('#reset');
	#presetsButton    = document.querySelector('#preset button');
	#trackSettings    = document.querySelector('#track-settings');
	#trackPosition    = document.querySelector('#track-settings-title span');
	#positionSelect   = document.querySelector('#position');

	constructor({ bus, parent }) {
		this.#bus = bus;
		this.#ui = parent;
		this.#systemColor = matchMedia('(prefers-color-scheme: dark)');

		const options = Array.from({ length: this.#ui.config.tracksLength - 1 }, (_, i) => new Option(i + 2, i + 1));
		this.#positionSelect.firstElementChild.after(...options);

		document.addEventListener('click',              (event) => this.#handleClick(event));
		this.#ui.container.addEventListener('input',    (event) => this.#handleInput(event));
		this.#ui.container.addEventListener('change',   (event) => this.#handleChange(event));
		this.#trackSettings.addEventListener('submit',  (event) => this.#setTrack());
		this.#trackSettings.addEventListener('command', (event) => this.#showTrackSettings(event));
		this.#systemColor.addEventListener('change',    (event) => this.#setTheme(event));
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
			artist: this.#ui.appTitle,
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
		const sourceIndex = this.#ui.getTrackIndex(this.#track);
		const newPosition = parseInt(this.#positionSelect.value);

		if (newPosition === -1) {
			this.#ui.swap.trashTrack(sourceIndex);
			return;
		}

		const values = this.#track.dataset;
		const fields = {
			bars:   this.#ui.setBars.value,
			beats:  this.#ui.setBeats.value,
			steps:  this.#ui.setSteps.value,
			phrase: this.#ui.setPhrase.value,
		};
		const changes = {};
		for (const [key, newValue] of Object.entries(fields)) {
			if (values[key] !== newValue) changes[key] = Number(newValue);
		}
		const hasChanges  = Object.keys(changes).length > 0;
		const currentPosition = this.#ui.tracksOrder.indexOf(sourceIndex);
		const targetIndex = newPosition > -1 && newPosition !== currentPosition
			? (newPosition > currentPosition
				? this.#ui.tracksOrder[newPosition + 1] ?? null
				: this.#ui.tracksOrder[newPosition] ?? null)
			: null;
		if (!hasChanges && targetIndex === null) return;

		document.startViewTransition(() => {
			if (targetIndex !== null) this.#ui.swap.moveTrack(sourceIndex, targetIndex);
			if (hasChanges) Object.assign(values, changes);
		});

		if (hasChanges) {
			this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail: { tracks: [{ id: values.index, changes }] } }));
		}
	}

	async #handleClick(event) {
		const { target } = event;
		if (target.name === this.#ui.names.step) {
			this.#changeNote(target);
		}
		else if (target === this.#resetButton) {
			this.#bus.dispatchEvent(new CustomEvent('interface:reset'));
		}
		else if (target === this.#ui.startButton) {
			this.#start();
		}
		else if (target === this.#presetsButton) {
			this.#ui.dialogs.showToast(target.dataset.message);
		}
		else if (target === this.#ui.themeButton) {
			this.#changeTheme();
		}
		else if (target === this.#skipButton) {
			this.#skipContent(event);
		}
		this.#bus.dispatchEvent(new CustomEvent('interface:userGesture'));
	}

	#handleChange({ target }) {
		if (target === this.#ui.tempo) {
			this.#bus.dispatchEvent(new CustomEvent('interface:change', { detail: 'tempo' }));
		} else if (target.name === this.#ui.names.volume) {
			this.#bus.dispatchEvent(new CustomEvent('interface:change', { detail: 'volumes' }));
		}
	}

	#changeNote(target) {
		const change = { sheet: [{ stepIndex: this.#ui.getStepIndex(target), value: Number(target.value) }] };
		this.#bus.dispatchEvent(new CustomEvent('interface:setStroke', { detail: change }));
	}

	#handleInput({ target }) {
		if (target.name === this.#ui.names.instrument) {
			this.#inputInstrument(target);
		}
		else if (target.name === this.#ui.names.volume) {
			this.#inputVolume(target);
		}
		else if (target === this.#ui.tempo) {
			this.#inputTempo(target);
		}
	}

	#showTrackSettings({ command, source }) {
		if (command !== 'show-modal') return;
		const track = this.#ui.getTrack(source);
		const index = this.#ui.getTrackIndex(track);
		const { bars, beats, steps, phrase } = track.dataset;
		const position =  this.#ui.tracksOrder.indexOf(index);
		const isLastTrack = this.#ui.getTrackInstrument(track) === this.#ui.config.defaultInstrument;

		let option = this.#positionSelect.firstElementChild;
		let stop = false;
		while (option) {
			const trackIndex = this.#ui.tracksOrder[option.value];
			if (trackIndex === undefined) break;
			const instrument = this.#ui.getTrackInstrument(this.#ui.tracks[trackIndex]);
			stop = stop || instrument === this.#ui.config.defaultInstrument;
			option.hidden = isLastTrack ? (option.value | 0) !== position : stop;
			option = option.nextElementSibling;
		}

		this.#track = track;
		this.#trackPosition.textContent = position + 1;
		this.#positionSelect.selectedIndex = position;
		this.#ui.setBars.value   = bars;
		this.#ui.setBeats.value  = beats;
		this.#ui.setSteps.value  = steps;
		this.#ui.setPhrase.value = phrase;
	}

	#inputInstrument(target) {
		const value = Number(target.value);
		const track = this.#ui.getTrack(target);
		const index = this.#ui.getTrackIndex(track);
		document.startViewTransition(() => track.dataset.instrument = value);
		const detail = { tracks: [ { id:index, changes: { instrument: value } } ] };
		this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail }));
	}

	#inputVolume(target) {
		const track = this.#ui.getTrack(target);
		const trackIndex = this.#ui.getTrackIndex(track);
		const value = Number(target.value);
		const detail = { volumes: [ { id:trackIndex, value } ] };
		this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail }));
	}

	#inputTempo(target) {
		this.#ui.bpm.textContent = target.value;
		const value = Number(target.value);
		const detail = { tempo: value };
		this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail }));
	}

	#start(state = !this.#ui.playing) {
		this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail: { playing: state } }));
	}

	#changeTheme() {
		const theme = !document.documentElement.classList.contains('dark');
		if (theme === this.#systemColor.matches) {
			delete localStorage.theme;
		} else {
			localStorage.theme = theme ? 'dark' : 'light';
		}
		this.#applyTheme(theme);
	}

	#setTheme({ matches }) {
		if (localStorage.theme !== undefined) return;
		this.#applyTheme(matches);
	}

	#applyTheme(theme) {
		document.startViewTransition(() => {
			document.documentElement.classList.toggle('dark', theme);
			this.#bus.dispatchEvent(new CustomEvent('interface:updateData', { detail: { theme } }));
		});
	}

	#skipContent(event) {
		event.preventDefault();
		this.#controls.focus({ preventScroll: true });
		this.#controls.scrollIntoView({ behavior: 'smooth' });
	}
}