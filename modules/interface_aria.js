export default class InterfaceAria {
	static #bpmToken         = 'bpm';
	static #volumeToken      = 'volume';
	static #strokeToken      = 'stroke';
	static #instrumentToken  = 'instrument';
	static #scopeRowSelector = '[scope="row"]';
	static #toolbarSelector  = '[role="toolbar"]';

	#ui;
	#bus;
	#rowNodes   = [];
	#sheetNodes = [];
	#templates  = {};
	#instrumentsNames;
	#volumeRatioPerCent;

	constructor({ bus, parent }) {
		this.#ui = parent;
		this.#bus = bus;
		this.#init();
		bus.addEventListener('audio:stop',           () => this.#playing = false);
		bus.addEventListener('interface:reset',      () => this.#resetAll());
		bus.addEventListener('interface:moveTrack',  ({ detail }) => this.#resetTrashed(detail));
		bus.addEventListener('interface:updateData', ({ detail }) => this.update(detail));
		this.#ui.trackParent.addEventListener('keydown', (event) => this.#navigate(event));
		this.#ui.trackParent.addEventListener('focusin', (event) => this.#syncTabIndex(event));
	}

	#init() {
		const track      = this.#ui.trackTemplate;
		const row        = track.querySelector(InterfaceAria.#scopeRowSelector);
		const steps      = Array.from(track.querySelectorAll(this.#ui.selectors.step));
		const sheet      = track.querySelector(InterfaceAria.#toolbarSelector);
		const volume     = track.querySelector(this.#ui.selectors.volume);
		const instrument = track.querySelector(this.#ui.selectors.instrument);
		const theme      = localStorage.getItem('theme') === 'dark' || null;

		if (theme !== null) {
			this.#theme = theme;
		}

		this.#instrumentsNames = Object.fromEntries(
			this.#ui.config.instrumentsLibrary.instruments.map(({ id, name }) => [id, name])
		);

		this.#templates = {
			rowLabel:        InterfaceAria.#readTemplate(row),
			stepLabels:      steps.map(step => InterfaceAria.#readTemplate(step)),
			sheetLabel:      InterfaceAria.#readTemplate(sheet),
			instrumentLabel: InterfaceAria.#readTemplate(instrument),
			volumeLabel:     InterfaceAria.#readTemplate(volume),
			tempoValuetext:  this.#ui.tempo.dataset.templateAriaValuetext,
			volumeValuetext: volume.dataset.templateAriaValuetext,
		};

		this.#ui.tempo.removeAttribute('data-template');
		this.#ui.tempo.removeAttribute('data-template-aria-valuetext');

		this.#volumeRatioPerCent = 100 / ((volume.max | 0) - (volume.min | 0));

		this.#ui.tracks.forEach((container, id) => {
			this.#rowNodes[id]   = container.querySelector(InterfaceAria.#scopeRowSelector);
			this.#sheetNodes[id] = container.querySelector(InterfaceAria.#toolbarSelector);
		});
	}

	static #readTemplate(element) {
		return {
			empty:  element.dataset.templateAriaLabelEmpty,
			filled: element.dataset.templateAriaLabelFilled,
		};
	}

	#navigate(event) {
		const { key } = event;
		const active = document.activeElement;
		
		if (!active || active.name !== this.#ui.names.step) return;

		const isHorizontal = key === 'ArrowRight' || key === 'ArrowLeft';
		const isVertical   = key === 'ArrowUp'    || key === 'ArrowDown';

		if (!isHorizontal && !isVertical) return;

		event.preventDefault();

		const track      = this.#ui.getTrack(active);
		const trackIndex = this.#ui.getTrackIndex(track);

		if (isVertical) {
			const isDown = key === 'ArrowDown';
			const targetTrack = isDown ? track.nextElementSibling : track.previousElementSibling;
			if (!targetTrack || (isDown && track.dataset.instrument === "0")) return;
			targetTrack.querySelector('[tabindex="0"]').focus();
			return;
		}

		const resolution = this.#ui.config.resolution;
		const offset     = trackIndex * resolution.track;
		const index      = this.#ui.getStepIndex(active) - offset;
		const direction  = key === 'ArrowRight' ? 1 : -1;
		const nextTarget = this.#getAdjacentStep(
			index, 
			offset, 
			resolution, 
			track.dataset.steps | 0, 
			track.dataset.beats | 0, 
			track.dataset.bars  | 0, 
			direction
		);
		this.#updateTabIndex(active, nextTarget, trackIndex)
		nextTarget.focus();
	}

	#getAdjacentStep(localIndex, offset, resolution, steps, beats, bars, direction) {
		const stepsPerBar = beats * steps;
		const totalSteps  = bars * stepsPerBar;
		const index = ((localIndex / resolution.bar | 0) * stepsPerBar) + 
			(((localIndex % resolution.bar) / resolution.beat | 0) * steps) + 
			(localIndex % resolution.beat);
		const nextIndex = (index + direction + totalSteps) % totalSteps;
		const nextLocal = ((nextIndex / stepsPerBar | 0) * resolution.bar) + 
			(((nextIndex % stepsPerBar) / steps | 0) * resolution.beat) + 
			(nextIndex % steps);
		return this.#ui.steps[offset + nextLocal];
	}

	#syncTabIndex(event) {
		const active = event.target;
		if (!active || active.name !== this.#ui.names.step || active.tabIndex === 0) return;
		const trackIndex = this.#ui.getTrackIndex(this.#ui.getTrack(active));
		this.#updateTabIndex(null, active, trackIndex);
	}

	#resetTrashed({ trashed }) {
		if (trashed !== null) this.#resetTabIndex(trashed);
	}

	#resetAll() {
		this.#ui.tracks.forEach((_, index) => this.#resetTabIndex(index));
	}

	#resetTabIndex(trackIndex) {
		const offset = trackIndex * this.#ui.config.resolution.track;
		const firstStep = this.#ui.steps[offset];
		if (firstStep && firstStep.tabIndex !== 0) {
			this.#updateTabIndex(null, firstStep, trackIndex);
		}
	}

	#updateTabIndex(oldTarget, newTarget, trackIndex) {
		oldTarget ??= this.#sheetNodes[trackIndex].querySelector('[tabindex="0"]');
		oldTarget.tabIndex = -1;
		newTarget.tabIndex = 0;
	}

	update({ tempo, sheet, tracks, volumes, playing, theme }) {
		if (tempo   !== undefined) this.#tempo   = tempo;
		if (sheet   !== undefined) this.#sheet   = sheet;
		if (theme   !== undefined) this.#theme   = theme;
		if (tracks  !== undefined) this.#tracks  = tracks;
		if (volumes !== undefined) this.#volumes = volumes;
		if (playing !== undefined) this.#playing = playing;
	}

	set #playing(value) {
		this.#ui.startButton.ariaChecked = value;
	}

	set #theme(value) {
		this.#ui.themeButton.ariaChecked = value;
	}

	set #tempo(value) {
		this.#ui.tempo.ariaValueText = InterfaceAria.#format(this.#templates.tempoValuetext, {
			[InterfaceAria.#bpmToken]: value
		});
	}

	set #sheet(values) {
		const maxSteps = this.#ui.config.resolution.beat;
		const empty    = this.#ui.config.emptyStroke;

		for (const { stepIndex, value } of values) {
			const step     = this.#ui.steps[stepIndex];
			const template = this.#templates.stepLabels[stepIndex % maxSteps];
			const isEmpty  = value === empty;

			step.ariaPressed = !isEmpty;
			step.ariaLabel   = isEmpty
				? template.empty
				: InterfaceAria.#format(template.filled, {
					[InterfaceAria.#strokeToken]: value
				});
		}
	}

	set #tracks(values) {
		const { defaultInstrument } = this.#ui.config;

		for (const { id, changes } of values) {
			if ('instrument' in changes) {
				const { instrument } = changes;
				const hasInstrument = instrument !== defaultInstrument && Object.hasOwn(this.#instrumentsNames, instrument);
				const name  = hasInstrument ? this.#instrumentsNames[instrument].toLowerCase() : null;
				const token = name ? { [InterfaceAria.#instrumentToken]: name } : null;

				const resolve = ({ empty, filled }) =>
					token ? InterfaceAria.#format(filled, token) : empty;

				this.#rowNodes[id].ariaLabel       = resolve(this.#templates.rowLabel);
				this.#sheetNodes[id].ariaLabel     = resolve(this.#templates.sheetLabel);
				this.#ui.volumes[id].ariaLabel     = resolve(this.#templates.volumeLabel);
				this.#ui.instruments[id].ariaLabel = hasInstrument
					? this.#templates.instrumentLabel.filled
					: this.#templates.instrumentLabel.empty;
			}
			if (['bars', 'beats', 'steps'].some(key => key in changes)) {
				this.#resetTabIndex(id);
			}
		}
	}

	set #volumes(values) {
		for (const { id, value } of values) {
			const volume  = this.#ui.volumes[id];
			const percent = Math.round((volume.value | 0) * this.#volumeRatioPerCent);
			volume.ariaValueText = InterfaceAria.#format(this.#templates.volumeValuetext, {
				[InterfaceAria.#volumeToken]: percent
			});
		}
	}

	static #format(template, replacements) {
		let result = template;
		for (const [token, value] of Object.entries(replacements)) {
			result = result.replace(`{{${token}}}`, value);
		}
		return result;
	}
}