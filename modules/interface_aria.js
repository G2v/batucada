export default class InterfaceAria {
	static #tokenPattern     = /{{(\w+)}}/g;
	static #bpmToken         = 'bpm';
	static #volumeToken      = 'volume';
	static #strokeToken      = 'stroke';
	static #nameToken        = 'name';
	static #phraseToken      = 'phrase';
	static #instrumentToken  = 'instrument';
	static #scopeRowSelector = '[scope="row"]';
	static #toolbarSelector  = '[role="toolbar"]';
	static #rovingSelector   = '[tabindex="0"]';
	static #navigationKeys   = Object.freeze(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

	#ui;
	#names;
	#events;
	#trackKeys;
	#resolution;
	#emptyStroke;
	#instruments;
	#phraseNames;
	#defaultPhrase;
	#defaultInstrument;
	#volumeRatioPerCent;

	#ready;
	#rowNodes       = [];
	#templates      = {};
	#sheetNodes     = [];
	#verticalRoving = null;

	constructor({ bus, parent, config, initial = {} }) {
		this.#ui                = parent;
		this.#events            = config.events;
		this.#names             = config.names;
		this.#trackKeys         = config.trackKeys;
		this.#resolution        = config.resolution;
		this.#emptyStroke       = config.emptyStroke;
		this.#defaultPhrase     = config.defaultPhrase;
		this.#defaultInstrument = config.defaultInstrument;
		this.#init(config, initial);
		bus.addEventListener(this.#events.audioStop,           () => this.#playing = false);
		bus.addEventListener(this.#events.interfaceReset,      () => this.#resetAllRoving());
		bus.addEventListener(this.#events.interfaceMoveTrack,  ({ detail }) => this.#resetMovedRoving(detail));
		bus.addEventListener(this.#events.interfaceUpdateData, ({ detail }) => this.update(detail));
		this.#ui.trackList.addEventListener('keydown', (event) => this.#navigate(event));
		this.#ui.trackList.addEventListener('focusin', (event) => this.#syncTabIndex(event));
	}

	#init({ selectors, instrumentsLibraryReady }, initial) {
		const track      = this.#ui.trackTemplate;
		const row        = track.querySelector(InterfaceAria.#scopeRowSelector);
		const steps      = Array.from(track.querySelectorAll(selectors.stepButton));
		const volume     = track.querySelector(selectors.volumeSlider);
		const instrument = track.querySelector(selectors.instrumentSelect);

		this.#phraseNames = Object.fromEntries(
			Array.from(document.querySelector(selectors.phraseSelect).options, option => [option.value | 0, option.textContent])
				.filter(([value]) => value !== this.#defaultPhrase)
		);

		this.#templates = {
			rowLabel:        InterfaceAria.#readTemplate(row),
			stepLabels:      steps.map(step => InterfaceAria.#readTemplate(step)),
			instrumentLabel: InterfaceAria.#readTemplate(instrument),
			tempoValuetext:  this.#ui.tempoSlider.dataset.templateAriaValuetext,
			volumeValuetext: volume.dataset.templateAriaValuetext,
		};

		this.#ui.tempoSlider.removeAttribute('data-template-aria-valuetext');

		this.#volumeRatioPerCent = 100 / ((volume.max | 0) - (volume.min | 0));

		this.#ui.tracks.forEach((container, id) => {
			this.#rowNodes[id]   = container.querySelector(InterfaceAria.#scopeRowSelector);
			this.#sheetNodes[id] = container.querySelector(InterfaceAria.#toolbarSelector);
		});

		this.#ready = instrumentsLibraryReady.then(({ instruments }) => {
			this.#instruments = Object.fromEntries(instruments.map(instrument => [instrument.id, instrument]));
		});

		this.update(initial);
	}

	static #readTemplate(element) {
		return {
			empty:  element.dataset.templateAriaLabelEmpty,
			filled: element.dataset.templateAriaLabelFilled,
			phrase: element.dataset.templateAriaLabelPhrase,
		};
	}

	static #format(template, replacements) {
		return template.replace(InterfaceAria.#tokenPattern, (_, token) => replacements[token] ?? '');
	}

	#hasInstrument(instrument) {
		return instrument !== this.#defaultInstrument && Object.hasOwn(this.#instruments, instrument);
	}

	#strokeName(instrument, value) {
		return this.#instruments[instrument]?.strokes[value - 1]?.name || null;
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

	#trackValue(trackIndex, key, changes) {
		return changes[key] ?? this.#ui.tracks[trackIndex].dataset[key] | 0;
	}

	#labelTrack(trackIndex, changes) {
		const instrument    = this.#trackValue(trackIndex, this.#trackKeys.instrument, changes);
		const phraseName    = this.#phraseNames[this.#trackValue(trackIndex, this.#trackKeys.phrase, changes)];
		const hasInstrument = this.#hasInstrument(instrument);
		const { empty, filled, phrase } = this.#templates.rowLabel;

		this.#rowNodes[trackIndex].ariaLabel = InterfaceAria.#format(hasInstrument ? filled : empty, {
			[InterfaceAria.#instrumentToken]: hasInstrument ? this.#instruments[instrument].name.toLowerCase() : '',
			[InterfaceAria.#phraseToken]:     phraseName
				? InterfaceAria.#format(phrase, { [InterfaceAria.#nameToken]: phraseName.toLowerCase() })
				: '',
		});
	}

	#relabelSteps(trackIndex, instrument) {
		const offset = trackIndex * this.#resolution.track;
		for (let local = 0; local < this.#resolution.track; local++) {
			const value = this.#ui.steps[offset + local].value | 0;
			if (value !== this.#emptyStroke) this.#labelStep(offset + local, value, instrument);
		}
	}

	#navigate(event) {
		const { key, target: active } = event;
		if (active.name !== this.#names.step || !InterfaceAria.#navigationKeys.includes(key)) return;

		event.preventDefault();

		const currentTrack     = this.#ui.getTrack(active);
		const currentStepIndex = this.#ui.getStepIndex(active) - this.#ui.getTrackIndex(currentTrack) * this.#resolution.track;
		const next             = this.#nextPosition(key, currentTrack, currentStepIndex);

		if (!next) return;

		const { nextTrack, nextStepIndex, verticalIndex } = next;
		const nextTrackIndex = this.#ui.getTrackIndex(nextTrack);
		const nextStep       = this.#ui.steps[nextTrackIndex * this.#resolution.track + nextStepIndex];

		this.#updateTabIndex(nextTrack === currentTrack ? active : null, nextStep, nextTrackIndex);
		nextStep.focus();
		this.#verticalRoving = verticalIndex ?? null;
	}

	#nextPosition(key, currentTrack, currentStepIndex) {
		switch (key) {
			case 'ArrowUp':
			case 'ArrowDown': {
				const isDown    = key === 'ArrowDown';
				const nextTrack = isDown ? currentTrack.nextElementSibling : currentTrack.previousElementSibling;
				if (!nextTrack || (isDown && this.#ui.getTrackInstrument(currentTrack) === this.#defaultInstrument)) return null;
				const verticalIndex = this.#verticalRoving ?? currentStepIndex;
				return { nextTrack, nextStepIndex: this.#clampPosition(verticalIndex, nextTrack.dataset), verticalIndex };
			}
			case 'Home':
				return { nextTrack: currentTrack, nextStepIndex: 0 };
			case 'End':
				return { nextTrack: currentTrack, nextStepIndex: this.#clampPosition(this.#resolution.track - 1, currentTrack.dataset) };
			default:
				return {
					nextTrack: currentTrack,
					nextStepIndex: this.#adjacentPosition(currentStepIndex, currentTrack.dataset, key === 'ArrowRight' ? 1 : -1),
				};
		}
	}

	#clampPosition(local, { bars, beats, steps }) {
		const { bar: barSize, beat: beatSize } = this.#resolution;
		const bar  = Math.min(local / barSize | 0,              (bars  | 0) - 1);
		const beat = Math.min((local % barSize) / beatSize | 0, (beats | 0) - 1);
		const step = Math.min(local % beatSize,                 (steps | 0) - 1);
		return bar * barSize + beat * beatSize + step;
	}

	#adjacentPosition(local, { bars, beats, steps }, direction) {
		const { bar: barSize, beat: beatSize } = this.#resolution;
		const perStep = steps | 0;
		const perBar  = (beats | 0) * perStep;
		const total   = (bars  | 0) * perBar;
		const index   = ((local / barSize | 0) * perBar) +
			(((local % barSize) / beatSize | 0) * perStep) +
			(local % beatSize);
		const next = (index + direction + total) % total;
		return ((next / perBar | 0) * barSize) +
			(((next % perBar) / perStep | 0) * beatSize) +
			(next % perStep);
	}

	#syncTabIndex({ target }) {
		this.#verticalRoving = null;
		if (target.name !== this.#names.step || target.tabIndex === 0) return;
		this.#updateTabIndex(null, target, this.#ui.getTrackIndex(this.#ui.getTrack(target)));
	}

	#resetMovedRoving({ trashed }) {
		if (trashed !== null) this.#resetRoving(trashed);
	}

	#resetAllRoving() {
		this.#ui.tracks.forEach((_, index) => this.#resetRoving(index));
	}

	#resetRoving(trackIndex) {
		const first = this.#ui.steps[trackIndex * this.#resolution.track];
		if (first.tabIndex !== 0) this.#updateTabIndex(null, first, trackIndex);
	}

	#clampRoving(trackIndex, changes = {}) {
		const { bars, beats, steps } = this.#trackKeys;
		const roving = this.#roving(trackIndex);
		const offset = trackIndex * this.#resolution.track;
		const local  = roving ? this.#ui.getStepIndex(roving) - offset : 0;
		const step   = this.#ui.steps[offset + this.#clampPosition(local, {
			bars:  this.#trackValue(trackIndex, bars,  changes),
			beats: this.#trackValue(trackIndex, beats, changes),
			steps: this.#trackValue(trackIndex, steps, changes),
		})];

		if (step && step !== roving) this.#updateTabIndex(roving, step, trackIndex);
	}

	#roving(trackIndex) {
		return this.#sheetNodes[trackIndex].querySelector(InterfaceAria.#rovingSelector);
	}

	#updateTabIndex(oldTarget, newTarget, trackIndex) {
		oldTarget ??= this.#roving(trackIndex);
		if (oldTarget) oldTarget.tabIndex = -1;
		newTarget.tabIndex = 0;
	}

	update(changes) {
		this.#ready.then(() => this.#apply(changes));
	}

	#apply({ tempo, sheet, tracks, volumes, playing }) {
		if (tempo   !== undefined) this.#tempo   = tempo;
		if (tracks  !== undefined) this.#tracks  = tracks;
		/* sheet doit être défini après tracks */
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
			const track = this.#ui.tracks[stepIndex / this.#resolution.track | 0];
			this.#labelStep(stepIndex, value, this.#ui.getTrackInstrument(track));
		}
	}

	set #tracks(values) {
		for (const { id, changes } of values) {
			const { instrument, phrase } = changes;

			if (instrument !== undefined) {
				this.#ui.instruments[id].ariaLabel = this.#hasInstrument(instrument)
					? this.#templates.instrumentLabel.filled
					: this.#templates.instrumentLabel.empty;
				this.#relabelSteps(id, instrument);
			}

			if (instrument !== undefined || phrase !== undefined) this.#labelTrack(id, changes);
			this.#clampRoving(id, changes);
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