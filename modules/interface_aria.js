export default class InterfaceAria {
	static #bpmToken         = 'bpm';
	static #volumeToken      = 'volume';
	static #strokeToken      = 'stroke';
	static #instrumentToken  = 'instrument';
	static #scopeRowSelector = '[scope="row"]';
	static #toolbarSelector  = '[role="toolbar"]';

	static #strokes = [
		'',
		'note 1',
		'note 2',
		'note 3',
	];

	#ui;
	#bus;
	#rowNodes = [];
	#sheetNodes = [];
	#templates = {};
	#volumeRatioPerCent;
	#emptyInstrumentName;

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

		this.#templates = {
			rowLabel:        row.dataset.templateAriaLabel,
			stepLabels:      steps.map(step => step.dataset.templateAriaLabel),
			sheetLabel:      sheet.dataset.templateAriaLabel,
			tempoValuetext:  this.#ui.tempo.dataset.templateAriaValuetext,
			instrumentLabel: instrument.dataset.templateAriaLabel,
			volumeLabel:     volume.dataset.templateAriaLabel,
			volumeValuetext: volume.dataset.templateAriaValuetext
		};

		this.#ui.tempo.removeAttribute('data-template');
		this.#ui.tempo.removeAttribute('data-template-aria-valuetext');

		InterfaceAria.#strokes[0] = steps[0].dataset.templateDefaultStroke;
		this.#emptyInstrumentName = row.dataset.templateDefaultInstrument;
		this.#volumeRatioPerCent = 100 / ((volume.max | 0) - (volume.min | 0));

		this.#ui.tracks.forEach((container, id) => {
			this.#rowNodes[id] = container.querySelector(InterfaceAria.#scopeRowSelector);
			this.#sheetNodes[id] = container.querySelector(InterfaceAria.#toolbarSelector);
		});
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
			const track = this.#ui.getTrack(active);
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
		this.#updateTabIndex(active, nextTarget, trackIndex, true);
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
		this.#resetTrack(trashed);
	}

	#resetAll() {
		this.#ui.tracks.forEach((_, index) => this.#resetTrack(index));
	}

	#resetTrack(index) {
		const offset = index * this.#ui.config.resolution.track;
		const firstStep = this.#ui.steps[offset];
		if (firstStep && firstStep.tabIndex !== 0) {
			this.#updateTabIndex(null, firstStep, index);
		}
	}


	#updateTabIndex(oldTarget, newTarget, trackIndex, shouldFocus = false) {
		oldTarget ??= this.#sheetNodes[trackIndex].querySelector('[tabindex="0"]');
		oldTarget.tabIndex = -1;
		if (newTarget) {
			newTarget.tabIndex = 0;
			if (shouldFocus) newTarget.focus();
		}
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
		for (const { stepIndex, value } of values) {
			const step = this.#ui.steps[stepIndex];
			const template = this.#templates.stepLabels[stepIndex % maxSteps];
			step.ariaPressed = value !== this.#ui.config.emptyStroke;
			step.ariaLabel = InterfaceAria.#format(template, {
				[InterfaceAria.#strokeToken]: InterfaceAria.#strokes[value]
			});
		}
	}

	set #tracks(values) {
		for (const { id, changes } of values) {
			if ('instrument' in changes) {
				const { instrument } = changes;
				const hasInstrument = instrument !== this.#ui.config.defaultInstrument;
				const name = hasInstrument ? this.#ui.instrumentsNames[instrument].toLowerCase() : this.#emptyInstrumentName;
				this.#rowNodes[id].ariaLabel       = InterfaceAria.#format(this.#templates.rowLabel, { [InterfaceAria.#instrumentToken]: name });
				this.#sheetNodes[id].ariaLabel     = InterfaceAria.#format(this.#templates.sheetLabel, { [InterfaceAria.#instrumentToken]: name });
				this.#ui.volumes[id].ariaLabel     = InterfaceAria.#format(this.#templates.volumeLabel, { [InterfaceAria.#instrumentToken]: name });
				this.#ui.instruments[id].ariaLabel = this.#templates.instrumentLabel.split('|')[+hasInstrument];
			}
		}
	}

	set #volumes(values) {
		for (const { id, value } of values) {
			const volume = this.#ui.volumes[id];
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