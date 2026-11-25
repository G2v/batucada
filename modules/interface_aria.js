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
	#song;
	#names;
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

	constructor({ parent, config, song }) {
		this.#ui                = parent;
		this.#song              = song;
		this.#names             = config.names;
		this.#resolution        = config.resolution;
		this.#emptyStroke       = config.emptyStroke;
		this.#defaultPhrase     = config.defaultTrack.phrase;
		this.#defaultInstrument = config.defaultTrack.instrument;
		this.#init(config);
		song.addEventListener('change', ({ detail }) => this.#ready.then(() => this.#render(detail), () => {}));
		this.#ui.trackList.addEventListener('keydown', (event) => this.#navigate(event));
		this.#ui.trackList.addEventListener('focusin', (event) => this.#syncTabIndex(event));
	}

	#init({ selectors, instrumentsLibraryReady }) {
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
			const all = [...this.#song.tracks.keys()];
			this.#render({ tempo: true, tracks: all, steps: [], volumes: all });
		});
		this.#ready.catch(() => {});
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

	#labelStep(stepIndex) {
		const { sheet, tracks } = this.#song;
		const value      = sheet[stepIndex];
		const instrument = tracks[stepIndex / this.#resolution.track | 0].instrument;
		const step       = this.#ui.steps[stepIndex];
		const template = this.#templates.stepLabels[stepIndex % this.#resolution.beat];
		const isEmpty  = value === this.#emptyStroke;
		const stroke   = isEmpty ? null : this.#strokeName(instrument, value);

		step.ariaPressed = !isEmpty;
		step.ariaLabel   = stroke
			? InterfaceAria.#format(template.filled, { [InterfaceAria.#strokeToken]: stroke })
			: template.empty;
	}

	#labelTrack(trackIndex) {
		const { instrument, phrase: phraseValue } = this.#song.tracks[trackIndex];
		const phraseName    = this.#phraseNames[phraseValue];
		const hasInstrument = this.#hasInstrument(instrument);
		const { empty, filled, phrase } = this.#templates.rowLabel;

		this.#rowNodes[trackIndex].ariaLabel = InterfaceAria.#format(hasInstrument ? filled : empty, {
			[InterfaceAria.#instrumentToken]: hasInstrument ? this.#instruments[instrument].name.toLowerCase() : '',
			[InterfaceAria.#phraseToken]:     phraseName
				? InterfaceAria.#format(phrase, { [InterfaceAria.#nameToken]: phraseName.toLowerCase() })
				: '',
		});
	}

	#relabelSteps(trackIndex) {
		const { sheet } = this.#song;
		const offset = trackIndex * this.#resolution.track;
		for (let index = offset; index < offset + this.#resolution.track; index++) {
			if (sheet[index] !== this.#emptyStroke) this.#labelStep(index);
		}
	}

	#navigate(event) {
		const { key, target: active } = event;
		if (active.name !== this.#names.step || !InterfaceAria.#navigationKeys.includes(key)) return;

		event.preventDefault();

		const { track: trackSize } = this.#resolution;
		const index = this.#ui.getStepIndex(active);
		const id    = index / trackSize | 0;
		const next  = this.#nextPosition(key, id, index % trackSize);
		if (!next) return;

		const nextStep = this.#ui.steps[next.id * trackSize + next.local];
		this.#updateTabIndex(next.id === id ? active : null, nextStep, next.id);
		nextStep.focus();
		this.#verticalRoving = next.verticalIndex ?? null;
	}

	#nextPosition(key, id, local) {
		const { tracks, activeTracks } = this.#song;
		switch (key) {
			case 'ArrowUp':
			case 'ArrowDown': {
				const nextId = activeTracks[activeTracks.indexOf(id) + (key === 'ArrowDown' ? 1 : -1)];
				if (nextId === undefined) return null;
				const verticalIndex = this.#verticalRoving ?? local;
				return { id: nextId, local: this.#clampPosition(verticalIndex, tracks[nextId]), verticalIndex };
			}
			case 'Home':
				return { id, local: 0 };
			case 'End':
				return { id, local: this.#clampPosition(this.#resolution.track - 1, tracks[id]) };
			default:
				return { id, local: this.#adjacentPosition(local, tracks[id], key === 'ArrowRight' ? 1 : -1) };
		}
	}

	#clampPosition(local, { bars, beats, steps }) {
		const { bar: barSize, beat: beatSize } = this.#resolution;
		const bar  = Math.min(local / barSize | 0,              bars  - 1);
		const beat = Math.min((local % barSize) / beatSize | 0, beats - 1);
		const step = Math.min(local % beatSize,                 steps - 1);
		return bar * barSize + beat * beatSize + step;
	}

	#adjacentPosition(local, { bars, beats, steps }, direction) {
		const { bar: barSize, beat: beatSize } = this.#resolution;
		const perBar = beats * steps;
		const total  = bars * perBar;
		const index  = ((local / barSize | 0) * perBar) +
			(((local % barSize) / beatSize | 0) * steps) +
			(local % beatSize);
		const next = (index + direction + total) % total;
		return ((next / perBar | 0) * barSize) +
			(((next % perBar) / steps | 0) * beatSize) +
			(next % steps);
	}

	#syncTabIndex({ target }) {
		this.#verticalRoving = null;
		if (target.name !== this.#names.step || target.tabIndex === 0) return;
		this.#updateTabIndex(null, target, this.#ui.getStepIndex(target) / this.#resolution.track | 0);
	}

	#resetAllRoving() {
		this.#ui.tracks.forEach((_, index) => this.#resetRoving(index));
	}

	#resetRoving(trackIndex) {
		const first = this.#ui.steps[trackIndex * this.#resolution.track];
		if (first.tabIndex !== 0) this.#updateTabIndex(null, first, trackIndex);
	}

	#clampRoving(trackIndex) {
		const roving = this.#roving(trackIndex);
		const offset = trackIndex * this.#resolution.track;
		const local  = roving ? this.#ui.getStepIndex(roving) - offset : 0;
		const step   = this.#ui.steps[offset + this.#clampPosition(local, this.#song.tracks[trackIndex])];

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

	#render({ tempo, tracks, steps, volumes, trashed, reset }) {
		if (tempo) this.#renderTempo();
		tracks.forEach(id => this.#renderTrack(id));
		steps.forEach(index => this.#labelStep(index));
		volumes.forEach(id => this.#renderVolume(id));
		if (trashed !== undefined) this.#resetRoving(trashed);
		if (reset) this.#resetAllRoving();
	}

	#renderTempo() {
		this.#ui.tempoSlider.ariaValueText = InterfaceAria.#format(this.#templates.tempoValuetext, {
			[InterfaceAria.#bpmToken]: this.#song.tempo
		});
	}

	#renderTrack(id) {
		this.#ui.instruments[id].ariaLabel = this.#hasInstrument(this.#song.tracks[id].instrument)
			? this.#templates.instrumentLabel.filled
			: this.#templates.instrumentLabel.empty;
		this.#relabelSteps(id);
		this.#labelTrack(id);
		this.#clampRoving(id);
	}

	#renderVolume(id) {
		const percent = Math.round(this.#song.volumes[id] * this.#volumeRatioPerCent);
		this.#ui.volumes[id].ariaValueText = InterfaceAria.#format(this.#templates.volumeValuetext, {
			[InterfaceAria.#volumeToken]: percent
		});
	}
}