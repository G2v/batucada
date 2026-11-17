import storage from '../config/storage.js';

const names = Object.freeze({
	step:       'step',
	volume:     'volume',
	instrument: 'instrument',
});

const selectors = Object.freeze({
	bar:              '.bar',
	beat:             '.beat',
	track:            '.track',
	stepButton:       `[name="${names.step}"]`,
	volumeSlider:     `[name="${names.volume}"]`,
	instrumentSelect: `[name="${names.instrument}"]`,

	appTitle:        '#app-title',
	container:       'main',
	trackList:       'tbody',
	trashZone:       '#trash',
	endDropZone:     'tfoot .dropzone',
	sequenceTitle:   '#titled',
	untitledLabel:   '#untitled',
	trackTemplate:   'template',
	controlsSection: '#controls',

	tempoValue:       '#tempo span',
	tempoSlider:      '#tempo input',

	startButton:       '#start',
	themeButton:       '#theme',
	skipButton:        '#skip',
	resetButton:       '#reset',
	presetsSelect:     '#preset select',
	appMenuButton:     '[commandfor="app-menu"]',
	presetEditButton:  '[commandfor="preset-edit"]',
	presetsMenuButton: '#preset > button',

	trackSettingsDialog: '#track-settings',
	trackPositionText:   '#track-settings-title span',

	barsSelect:       '#track-settings [name="bars"]',
	beatsSelect:      '#track-settings [name="beats"]',
	stepsSelect:      '#track-settings [name="steps"]',
	phraseSelect:     '#track-settings [name="phrase"]',
	positionSelect:   '#track-settings [name="position"]',
	deleteCheckbox:   '#track-settings [name="delete"]',

	aboutDialog:       '#about',
	aboutContactLink:  '#contact a',
	aboutVersionText:  '#version #version_number',
	aboutUpdate:       '#version #update',

	preferencesForm: '#preferences form',

	instrumentsDialog:        '#instruments',
	instrumentsLibraryName:   '#instruments p span',
	instrumentsRestoreButton: '#instruments [commandfor="instruments-restore"]',
	importConfirmDialog:      '#instruments-import',
	restoreConfirmDialog:     '#instruments-restore',

	presetsDialog:      '#presets',
	presetsDate:        '#presets time',
	presetEditDialog:   '#preset-edit',
	presetEditForm:     '#preset-edit form',
	presetDeleteDialog: '#presets-delete',

	toast:             '#toast',
	toastMessage:      '#toast p',
	toastCancelButton: '#toast button',
});

const emptyStroke  = 0;
const tracksLength = 24;

const setSearchParam    = 'set';
const tempoSearchParam  = 'bpm';
const titleSearchParam  = 'title';
const volumeSearchParam = 'vol';

const formatDigits          = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const defaultSetValue       = formatDigits[0];
const trackFormatSeparator  = '-';
const trackHeaderLength     = 4;
const trackFormatAllocation = Object.freeze({ base: 9, steps: 9, beats: 9, bars: 9, phrase: 9, reserve: 4 });

const instrumentsLibraryReady = (async () => {
	const url     = new URL(storage.instrumentsMetadataFile, location.href).href;
	const network = fetch(url);
	const custom  = caches?.match(url, { cacheName: storage.dataCache }).catch(() => null);

	const cached = await custom;
	if (cached) {
		network.then(response => response.body?.cancel()).catch(() => {});
		return cached.json();
	}
	const response = await network;
	if (!response.ok) throw new Error(`${url} ${response.status}`);
	return response.json();
})();

instrumentsLibraryReady.catch(() => {});

const query         = selector => document.querySelector(selector);
const optionsValues = node => Object.freeze(Array.from(node.options, option => option.value | 0));

const trackTemplate = query(selectors.trackTemplate).content.querySelector(selectors.track);
const volumeSlider  = trackTemplate.querySelector(selectors.volumeSlider);
const barsValues    = optionsValues(query(selectors.barsSelect));
const beatsValues   = optionsValues(query(selectors.beatsSelect));
const stepsValues   = optionsValues(query(selectors.stepsSelect));
const phraseValues  = optionsValues(query(selectors.phraseSelect));

const maxBars       = Math.max(...barsValues);
const maxBeats      = Math.max(...beatsValues);
const maxSteps      = Math.max(...stepsValues);
const tempoSlider   = query(selectors.tempoSlider);
const defaultTempo  = tempoSlider.value | 0;
const tempoMin      = tempoSlider.min   | 0;
const tempoMax      = tempoSlider.max   | 0;
const tempoStep     = tempoSlider.step  | 0 || 1;
const defaultGain   = volumeSlider.value | 0;
const maxGain       = volumeSlider.max   | 0;
const defaultVolume = formatDigits[defaultGain];

const { bars, beats, steps, phrase, instrument } = trackTemplate.dataset;
const defaultTrack = Object.freeze({
	bars:       bars       | 0,
	beats:      beats      | 0,
	steps:      steps      | 0,
	phrase:     phrase     | 0,
	instrument: instrument | 0,
});

const resolution = Object.freeze({
	beat:  maxSteps,
	bar:   maxSteps * maxBeats,
	track: maxSteps * maxBeats * maxBars,
	maxBars, maxBeats,
});

const defaultPreferences = Object.freeze(Object.fromEntries(
	Array.from(query(selectors.preferencesForm).elements, ({ name, options }) => {
		const { value } = Array.from(options).find(option => option.defaultSelected) ?? options[0];
		return [name, Number.isNaN(Number(value)) ? value : Number(value)];
	})
));

export const config = Object.freeze({
	names,
	selectors,
	resolution,
	emptyStroke,
	tracksLength,
	maxGain,
	tempoMin,
	tempoMax,
	tempoStep,
	defaultGain,
	defaultTempo,
	defaultTrack,
	defaultVolume,
	defaultPreferences,
	barsValues,
	beatsValues,
	stepsValues,
	phraseValues,
	formatDigits,
	defaultSetValue,
	setSearchParam,
	tempoSearchParam,
	titleSearchParam,
	volumeSearchParam,
	trackHeaderLength,
	trackFormatSeparator,
	trackFormatAllocation,
	instrumentsLibraryReady,
});