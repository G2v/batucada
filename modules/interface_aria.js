export default class InterfaceAria {
	static #bpmToken         = 'bpm';
	static #volumeToken      = 'volume';
	static #strokeToken      = 'stroke';
	static #instrumentToken  = 'instrument';
	static #scopeRowSelector = '[scope="row"]';
	static #toolbarSelector  = '[role="toolbar"]';
	static #rovingSelector   = '[tabindex="0"]';
	static #keys             = Object.freeze(['bars', 'beats', 'steps']);

	#ui;
	#rowNodes   = [];
	#sheetNodes = [];
	#templates  = {};
	#strokeNames;
	#instrumentNames;
	#trackInstruments;
	#volumeRatioPerCent;

	constructor({ bus, parent }) {
		this.#ui = parent;
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
		const volume     = track.querySelector(this.#ui.selectors.volume);
		const instrument = track.querySelector(this.#ui.selectors.instrument);

		const { instruments } = this.#ui.config.instrumentsLibrary;

		this.#trackInstruments = new Array(this.#ui.config.tracksLength).fill(this.#ui.config.defaultInstrument);
		this.#instrumentNames  = Object.fromEntries(instruments.map(({ id, name }) => [id, name]));
		this.#strokeNames      = Object.fromEntries(
			instruments.map(({ id, strokes }) => [id, strokes.map(({ name }) => name)])
		);

		this.#templates = {
			rowLabel:        InterfaceAria.#readTemplate(row),
			stepLabels:      steps.map(step => InterfaceAria.#readTemplate(step)),
			instrumentLabel: InterfaceAria.#readTemplate(instrument),
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

	static #format(template, replacements) {
		let result = template;
		for (const [token, value] of Object.entries(replacements)) {
			result = result.replace(`{{${token}}}`, value);
		}
		return result;
	}

	#strokeName(instrument, value) {
		return this.#strokeNames[instrument]?.[value - 1]
			|| this.#strokeNames[this.#ui.config.defaultInstrument]?.[0]
			|| null;
	}

	#labelStep(stepIndex, value, instrument) {
		const { resolution, emptyStroke } = this.#ui.config;
		const step     = this.#ui.steps[stepIndex];
		const template = this.#templates.stepLabels[stepIndex % resolution.beat];
		const isEmpty  = value === emptyStroke;
		const stroke   = isEmpty ? null : this.#strokeName(instrument, value);

		step.ariaPressed = !isEmpty;
		step.ariaLabel   = stroke
			? InterfaceAria.#format(template.filled, { [InterfaceAria.#strokeToken]: stroke })
			: template.empty;
	}

	#relabelSteps(trackIndex, instrument) {
		const { resolution, emptyStroke } = this.#ui.config;
		const { bars, beats, steps } = this.#ui.tracks[trackIndex].dataset;
		const barCount  = bars  | 0;
		const beatCount = beats | 0;
		const stepCount = steps | 0;
		const offset    = trackIndex * resolution.track;

		for (let bar = 0; bar < barCount; bar++) {
			for (let beat = 0; beat < beatCount; beat++) {
				const base = offset + bar * resolution.bar + beat * resolution.beat;
				for (let step = 0; step < stepCount; step++) {
					const value = this.#ui.steps[base + step].value | 0;
					if (value !== emptyStroke) this.#labelStep(base + step, value, instrument);
				}
			}
		}
	}

	#navigate(event) {
		const { key, target: active } = event;
		if (active.name !== this.#ui.names.step) return;

		const isHorizontal = key === 'ArrowRight' || key === 'ArrowLeft';
		const isVertical   = key === 'ArrowUp'    || key === 'ArrowDown';
		const isEdge       = key === 'Home'       || key === 'End';

		if (!isHorizontal && !isVertical && !isEdge) return;

		event.preventDefault();

		const resolution = this.#ui.config.resolution;
		const track      = this.#ui.getTrack(active);
		const trackIndex = this.#ui.getTrackIndex(track);
		const local      = this.#ui.getStepIndex(active) - trackIndex * resolution.track;

		let targetTrack = track;
		let targetLocal;

		if (isVertical) {
			const isDown = key === 'ArrowDown';
			targetTrack = isDown ? track.nextElementSibling : track.previousElementSibling;
			if (!targetTrack || (isDown && track.dataset.instrument === "0")) return;
			targetLocal = this.#clampPosition(local, resolution, targetTrack.dataset);
		} else if (isEdge) {
			targetLocal = key === 'Home' ? 0 : this.#clampPosition(resolution.track - 1, resolution, track.dataset);
		} else {
			targetLocal = this.#adjacentPosition(local, resolution, track.dataset, key === 'ArrowRight' ? 1 : -1);
		}

		const targetIndex = this.#ui.getTrackIndex(targetTrack);
		const nextStep    = this.#ui.steps[targetIndex * resolution.track + targetLocal];

		this.#updateTabIndex(targetTrack === track ? active : null, nextStep, targetIndex);
		nextStep.focus();
	}

	#clampPosition(local, resolution, { bars, beats, steps }) {
		const bar  = Math.min(local / resolution.bar | 0,                     (bars  | 0) - 1);
		const beat = Math.min((local % resolution.bar) / resolution.beat | 0, (beats | 0) - 1);
		const step = Math.min(local % resolution.beat,                        (steps | 0) - 1);
		return bar * resolution.bar + beat * resolution.beat + step;
	}

	#adjacentPosition(local, resolution, { bars, beats, steps }, direction) {
		const perStep = steps | 0;
		const perBar  = (beats | 0) * perStep;
		const total   = (bars  | 0) * perBar;
		const index   = ((local / resolution.bar | 0) * perBar) +
			(((local % resolution.bar) / resolution.beat | 0) * perStep) +
			(local % resolution.beat);
		const next = (index + direction + total) % total;
		return ((next / perBar | 0) * resolution.bar) +
			(((next % perBar) / perStep | 0) * resolution.beat) +
			(next % perStep);
	}

	#syncTabIndex({ target }) {
		if (target.name !== this.#ui.names.step || target.tabIndex === 0) return;
		this.#updateTabIndex(null, target, this.#ui.getTrackIndex(this.#ui.getTrack(target)));
	}

	#resetTrashed({ trashed }) {
		if (trashed !== null) this.#resetTabIndex(trashed);
	}

	#resetAll() {
		this.#ui.tracks.forEach((_, index) => this.#resetTabIndex(index));
	}

	#resetTabIndex(trackIndex) {
		const firstStep = this.#ui.steps[trackIndex * this.#ui.config.resolution.track];
		if (firstStep && firstStep.tabIndex !== 0) this.#updateTabIndex(null, firstStep, trackIndex);
	}

	#updateTabIndex(oldTarget, newTarget, trackIndex) {
		oldTarget ??= this.#sheetNodes[trackIndex].querySelector(InterfaceAria.#rovingSelector);
		if (oldTarget) oldTarget.tabIndex = -1;
		newTarget.tabIndex = 0;
	}

	update({ tempo, sheet, tracks, volumes, playing }) {
		if (tempo   !== undefined) this.#tempo   = tempo;
		if (tracks  !== undefined) this.#tracks  = tracks;
		/* sheet needs to be set after tracks */
		if (sheet   !== undefined) this.#sheet   = sheet;
		if (volumes !== undefined) this.#volumes = volumes;
		if (playing !== undefined) this.#playing = playing;
	}

	set #playing(value) {
		this.#ui.startButton.ariaChecked = value;
	}

	set #tempo(value) {
		this.#ui.tempo.ariaValueText = InterfaceAria.#format(this.#templates.tempoValuetext, {
			[InterfaceAria.#bpmToken]: value
		});
	}

	set #sheet(values) {
		const { resolution: { track } } = this.#ui.config;
		for (const { stepIndex, value } of values) {
			this.#labelStep(stepIndex, value, this.#trackInstruments[stepIndex / track | 0]);
		}
	}

	set #tracks(values) {
		const { defaultInstrument } = this.#ui.config;

		for (const { id, changes } of values) {
			if ('instrument' in changes) {
				const { instrument } = changes;
				this.#trackInstruments[id] = instrument;
				const hasInstrument = instrument !== defaultInstrument && Object.hasOwn(this.#instrumentNames, instrument);
				const token = hasInstrument
					? { [InterfaceAria.#instrumentToken]: this.#instrumentNames[instrument].toLowerCase() }
					: null;
				const { empty, filled } = this.#templates.rowLabel;

				this.#rowNodes[id].ariaLabel = token ? InterfaceAria.#format(filled, token) : empty;
				this.#ui.instruments[id].ariaLabel = hasInstrument
					? this.#templates.instrumentLabel.filled
					: this.#templates.instrumentLabel.empty;
				this.#relabelSteps(id, instrument);
			}
			if (InterfaceAria.#keys.some(key => key in changes)) this.#resetTabIndex(id);
		}
	}

	set #volumes(values) {
		for (const { id } of values) {
			const volume  = this.#ui.volumes[id];
			const percent = Math.round((volume.value | 0) * this.#volumeRatioPerCent);
			volume.ariaValueText = InterfaceAria.#format(this.#templates.volumeValuetext, {
				[InterfaceAria.#volumeToken]: percent
			});
		}
	}
}