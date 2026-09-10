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
	#events;
	#names;
	#resolution;
	#emptyStroke;
	#strokeNames;
	#instrumentNames;
	#trackInstruments;
	#defaultInstrument;
	#volumeRatioPerCent;

	#ready;
	#rowNodes   = [];
	#sheetNodes = [];
	#templates  = {};

	constructor({ bus, parent, config, initial = {} }) {
		this.#ui                = parent;
		this.#events            = config.events;
		this.#names             = config.names;
		this.#resolution        = config.resolution;
		this.#emptyStroke       = config.emptyStroke;
		this.#defaultInstrument = config.defaultInstrument;
		this.#init(config);
		bus.addEventListener(this.#events.audioStop,           () => this.#playing = false);
		bus.addEventListener(this.#events.interfaceReset,      () => this.#resetAll());
		bus.addEventListener(this.#events.interfaceMoveTrack,  ({ detail }) => this.#resetTrashed(detail));
		bus.addEventListener(this.#events.interfaceUpdateData, ({ detail }) => this.update(detail));
		this.#ui.trackList.addEventListener('keydown', (event) => this.#navigate(event));
		this.#ui.trackList.addEventListener('focusin', (event) => this.#syncTabIndex(event));

		this.#ready = config.instrumentsLibraryReady.then(({ instruments }) => {
			this.#initNames(instruments);
			this.#update(initial);
		});
	}

	#init({ tracksLength, selectors }) {
		const track      = this.#ui.trackTemplate;
		const row        = track.querySelector(InterfaceAria.#scopeRowSelector);
		const steps      = Array.from(track.querySelectorAll(selectors.stepButton));
		const volume     = track.querySelector(selectors.volumeSlider);
		const instrument = track.querySelector(selectors.instrumentSelect);

		this.#trackInstruments = new Array(tracksLength).fill(this.#defaultInstrument);

		this.#templates = {
			rowLabel:        InterfaceAria.#readTemplate(row),
			stepLabels:      steps.map(step => InterfaceAria.#readTemplate(step)),
			instrumentLabel: InterfaceAria.#readTemplate(instrument),
			tempoValuetext:  this.#ui.tempoSlider.dataset.templateAriaValuetext,
			volumeValuetext: volume.dataset.templateAriaValuetext,
		};

		this.#ui.tempoSlider.removeAttribute('data-template');
		this.#ui.tempoSlider.removeAttribute('data-template-aria-valuetext');

		this.#volumeRatioPerCent = 100 / ((volume.max | 0) - (volume.min | 0));

		this.#ui.tracks.forEach((container, id) => {
			this.#rowNodes[id]   = container.querySelector(InterfaceAria.#scopeRowSelector);
			this.#sheetNodes[id] = container.querySelector(InterfaceAria.#toolbarSelector);
		});
	}

	#initNames(instruments) {
		this.#instrumentNames = Object.fromEntries(instruments.map(({ id, name }) => [id, name]));
		this.#strokeNames     = Object.fromEntries(
			instruments.map(({ id, strokes }) => [id, strokes.map(({ name }) => name)])
		);
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
			|| this.#strokeNames[this.#defaultInstrument]?.[0]
			|| null;
	}

	#labelStep(stepIndex, value, instrument) {
		const step     = this.#ui.steps[stepIndex];
		const template = this.#templates.stepLabels[stepIndex % this.#resolution.beat];
		const isEmpty  = value === this.#emptyStroke;
		const stroke   = isEmpty ? null : this.#strokeName(instrument, value);

		step.ariaPressed = !isEmpty;
		step.ariaLabel   = stroke
			? InterfaceAria.#format(template.filled, { [InterfaceAria.#strokeToken]: stroke })
			: template.empty;
	}

	#relabelSteps(trackIndex, instrument) {
		const { bars, beats, steps } = this.#ui.tracks[trackIndex].dataset;
		const barCount  = bars  | 0;
		const beatCount = beats | 0;
		const stepCount = steps | 0;
		const offset    = trackIndex * this.#resolution.track;

		for (let bar = 0; bar < barCount; bar++) {
			for (let beat = 0; beat < beatCount; beat++) {
				const base = offset + bar * this.#resolution.bar + beat * this.#resolution.beat;
				for (let step = 0; step < stepCount; step++) {
					const value = this.#ui.steps[base + step].value | 0;
					if (value !== this.#emptyStroke) this.#labelStep(base + step, value, instrument);
				}
			}
		}
	}

	#navigate(event) {
		const { key, target: active } = event;
		if (active.name !== this.#names.step) return;

		const isHorizontal = key === 'ArrowRight' || key === 'ArrowLeft';
		const isVertical   = key === 'ArrowUp'    || key === 'ArrowDown';
		const isEdge       = key === 'Home'       || key === 'End';

		if (!isHorizontal && !isVertical && !isEdge) return;

		event.preventDefault();

		const track      = this.#ui.getTrack(active);
		const trackIndex = this.#ui.getTrackIndex(track);
		const local      = this.#ui.getStepIndex(active) - trackIndex * this.#resolution.track;

		let targetTrack = track;
		let targetLocal;

		if (isVertical) {
			const isDown = key === 'ArrowDown';
			targetTrack = isDown ? track.nextElementSibling : track.previousElementSibling;
			if (!targetTrack || (isDown && this.#ui.getTrackInstrument(track) === this.#defaultInstrument)) return;
			targetLocal = this.#clampPosition(local, targetTrack.dataset);
		} else if (isEdge) {
			targetLocal = key === 'Home' ? 0 : this.#clampPosition(this.#resolution.track - 1, track.dataset);
		} else {
			targetLocal = this.#adjacentPosition(local, track.dataset, key === 'ArrowRight' ? 1 : -1);
		}

		const targetIndex = this.#ui.getTrackIndex(targetTrack);
		const nextStep    = this.#ui.steps[targetIndex * this.#resolution.track + targetLocal];

		this.#updateTabIndex(targetTrack === track ? active : null, nextStep, targetIndex);
		nextStep.focus();
	}

	#clampPosition(local, { bars, beats, steps }) {
		const bar  = Math.min(local / this.#resolution.bar | 0,                     (bars  | 0) - 1);
		const beat = Math.min((local % this.#resolution.bar) / this.#resolution.beat | 0, (beats | 0) - 1);
		const step = Math.min(local % this.#resolution.beat,                        (steps | 0) - 1);
		return bar * this.#resolution.bar + beat * this.#resolution.beat + step;
	}

	#adjacentPosition(local, { bars, beats, steps }, direction) {
		const perStep = steps | 0;
		const perBar  = (beats | 0) * perStep;
		const total   = (bars  | 0) * perBar;
		const index   = ((local / this.#resolution.bar | 0) * perBar) +
			(((local % this.#resolution.bar) / this.#resolution.beat | 0) * perStep) +
			(local % this.#resolution.beat);
		const next = (index + direction + total) % total;
		return ((next / perBar | 0) * this.#resolution.bar) +
			(((next % perBar) / perStep | 0) * this.#resolution.beat) +
			(next % perStep);
	}

	#syncTabIndex({ target }) {
		if (target.name !== this.#names.step || target.tabIndex === 0) return;
		this.#updateTabIndex(null, target, this.#ui.getTrackIndex(this.#ui.getTrack(target)));
	}

	#resetTrashed({ trashed }) {
		if (trashed !== null) this.#resetTabIndex(trashed);
	}

	#resetAll() {
		this.#ui.tracks.forEach((_, index) => this.#resetTabIndex(index));
	}

	#resetTabIndex(trackIndex) {
		const firstStep = this.#ui.steps[trackIndex * this.#resolution.track];
		if (firstStep && firstStep.tabIndex !== 0) this.#updateTabIndex(null, firstStep, trackIndex);
	}

	#updateTabIndex(oldTarget, newTarget, trackIndex) {
		oldTarget ??= this.#sheetNodes[trackIndex].querySelector(InterfaceAria.#rovingSelector);
		if (oldTarget) oldTarget.tabIndex = -1;
		newTarget.tabIndex = 0;
	}

	update(changes) {
		this.#ready.then(() => this.#update(changes));
	}

	#update({ tempo, sheet, tracks, volumes, playing }) {
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
		this.#ui.tempoSlider.ariaValueText = InterfaceAria.#format(this.#templates.tempoValuetext, {
			[InterfaceAria.#bpmToken]: value
		});
	}

	set #sheet(values) {
		for (const { stepIndex, value } of values) {
			this.#labelStep(stepIndex, value, this.#trackInstruments[stepIndex / this.#resolution.track | 0]);
		}
	}

	set #tracks(values) {
		for (const { id, changes } of values) {
			if ('instrument' in changes) {
				const { instrument } = changes;
				this.#trackInstruments[id] = instrument;
				const hasInstrument = instrument !== this.#defaultInstrument && Object.hasOwn(this.#instrumentNames, instrument);
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