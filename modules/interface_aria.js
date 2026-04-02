export default class InterfaceAria {
	static #bpmToken        = 'bpm';
	static #volumeToken     = 'volume';
	static #strokeToken     = 'stroke';
	static #instrumentToken = 'instrument';

	static #strokes = [
		null,
		'note 1',
		'note 2',
		'note 3',
	];

	#ui;
	#bus;
	#rowNodes = [];
	#templates = {};
	#emptyStrokeValue;
	#volumeRatioPerCent;
	#emptyInstrumentName;

	constructor({ bus, parent }) {
		this.#ui = parent;
		this.#bus = bus;
		this.#init();
		bus.addEventListener('audio:stop', () => this.#playing = false);
		bus.addEventListener('interface:updateData', ({ detail }) => this.update(detail));
	}

	#init() {
		const track      = this.#ui.trackTemplate;
		const row        = track.querySelector('[scope="row"]');
		const step       = track.querySelector(this.#ui.selectors.step);
		const volume     = track.querySelector(this.#ui.selectors.volume);
		const instrument = track.querySelector(this.#ui.selectors.instrument);

		this.#templates = {
			rowLabel:        row.dataset.templateAriaLabel,
			stepLabel:       step.dataset.templateAriaLabel,
			tempoValuetext:  this.#ui.tempo.dataset.templateAriaValuetext,
			instrumentLabel: instrument.dataset.templateAriaLabel,
			volumeLabel:     volume.dataset.templateAriaLabel,
			volumeValuetext: volume.dataset.templateAriaValuetext
		};

		this.#ui.tempo.removeAttribute('data-template');
		this.#ui.tempo.removeAttribute('data-template-aria-valuetext');

		InterfaceAria.#strokes[0] = step.dataset.templateDefaultStroke;
		this.#emptyInstrumentName = row.dataset.templateDefaultInstrument;
		this.#emptyStrokeValue = this.#ui.config.emptyStroke;
		this.#volumeRatioPerCent = 100 / ((volume.max | 0) - (volume.min | 0));

		this.#ui.tracks.forEach((container, id) => {
			this.#rowNodes[id] = container.querySelector('[scope="row"]');
		});
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
		const template = this.#templates.stepLabel;
		for (const { stepIndex, value } of values) {
			const step = this.#ui.steps[stepIndex];
			step.ariaPressed = value !== this.#emptyStrokeValue;
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