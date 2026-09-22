import core_config from '../config/core.js';
import app_config  from '../config/app.js';

const names = Object.freeze({
	step:       'step',
	volume:     'volume',
	instrument: 'instrument',
});

const events = Object.freeze({

	audioStop:           'audio:stop',
	audioState:          'audio:state',
	audioChanged:        'audio:changed',
	audioUpdateData:     'audio:updateData',
	audioPushAnimations: 'audio:pushAnimations',

	interfaceReset:       'interface:reset',
	interfaceChange:      'interface:change',
	interfaceSetStroke:   'interface:setStroke',
	interfaceMoveTrack:   'interface:moveTrack',
	interfaceUpdateData:  'interface:updateData',
	interfaceUserGesture: 'interface:userGesture',
	interfaceInstall:     'interface:install',
	interfaceFindUpdate:  'interface:findUpdate',

	interfacePresetSelected: 'interface:presetSelected',
	interfacePresetsDelete:  'interface:presetsDelete',
	interfaceEditSave:       'interface:editSave',
	interfaceEditCancel:     'interface:editCancel',
	interfaceShare:          'interface:share',
	interfaceExport:         'interface:export',
	interfaceImport:         'interface:import',

	navigationDecoded:    'navigation:decoded',
	navigationChanged:    'navigation:changed',
	navigationCloseModal: 'navigation:closeModal',

	presetsUpdateData:     'presets:updateData',
	presetsInvalidName:    'presets:invalidName',
	presetsPresetSelected: 'presets:presetSelected',

	swClientNewVersion: 'sw-client:newVersion',
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
	sequenceTitle:   '#title',
	untitledLabel:   '#untitled',
	trackTemplate:   'template',
	controlsSection: '#controls',

	tempoValue:       '#tempo span',
	tempoSlider:      '#tempo input',

	startButton:       '#start',
	themeButton:       '#theme',
	skipButton:        '#skip',
	resetButton:       '#reset',
	appMenuButton:     '[commandfor="app-menu"]',
	presetEditButton:  '[commandfor="preset-edit"]',
	presetsMenuButton: '#preset > button',

	barsSelect:       '#bars',
	beatsSelect:      '#beats',
	stepsSelect:      '#steps',
	phraseSelect:     '#phrase',
	presetsSelect:    '#preset select',
	positionSelect:   '#position',

	trackSettingsDialog: '#track-settings',
	trackPositionText:   '#track-settings-title span',

	aboutDialog:       '#about',
	aboutContactLink:  '#contact a',
	aboutVersionText:  '#version span',
	aboutUpdateButton: '#version button',

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

const trackKeys = Object.freeze({
	bars:       'bars',
	beats:      'beats',
	steps:      'steps',
	phrase:     'phrase',
	instrument: 'instrument',
});

const trackFormatSeparator  = '-';
const trackFormatAllocation = Object.freeze({ phrase: 6, bars: 8, beats: 4, steps: 5, reserved: 4 });
const formatDigits          = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const instrumentsLibraryReady = (async () => {
	const url     = new URL(core_config.instrumentsMetadataFile, location.href).href;
	const network = fetch(url);
	const custom  = caches?.match(url, { cacheName: core_config.dataCache }).catch(() => null);

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
const optionsValues = node => Array.from(node.options, option => option.value | 0);

const trackTemplate = query(selectors.trackTemplate).content.querySelector(selectors.track);
const volumeSlider  = trackTemplate.querySelector(selectors.volumeSlider);
const barsValues    = optionsValues(query(selectors.barsSelect));
const beatsValues   = optionsValues(query(selectors.beatsSelect));
const stepsValues   = optionsValues(query(selectors.stepsSelect));
const phraseValues  = optionsValues(query(selectors.phraseSelect));

const maxBars       = Math.max(...barsValues);
const maxBeats      = Math.max(...beatsValues);
const maxSteps      = Math.max(...stepsValues);

const { bars, beats, steps, phrase, instrument } = trackTemplate.dataset;

const tempoSlider       = query(selectors.tempoSlider);
const defaultTempo      = tempoSlider.value | 0;
const tempoMin          = tempoSlider.min   | 0;
const tempoMax          = tempoSlider.max   | 0;
const tempoStep         = tempoSlider.step  | 0 || 1;
const defaultGain       = volumeSlider.value | 0;
const maxGain           = volumeSlider.max   | 0;
const defaultBars       = bars       | 0;
const defaultBeats      = beats      | 0;
const defaultSteps      = steps      | 0;
const defaultPhrase     = phrase     | 0;
const defaultInstrument = instrument | 0;


const indexFrom = (values, defaultValue) => Object.freeze(
	[defaultValue, ...values.filter(value => value !== defaultValue)]
);

const defaultVolume = formatDigits[defaultGain];

export const config = Object.freeze({
	...app_config,
	...core_config,
	names,
	events,
	trackKeys,
	selectors,
	instrumentsLibraryReady,
	emptyStroke:           0,
	resolution:            {
		beat:  maxSteps,
		bar:   maxSteps * maxBeats,
		track: maxSteps * maxBeats * maxBars,
		maxBars, maxBeats,
	},
	maxGain,
	defaultTempo,
	tempoMin,
	tempoMax,
	tempoStep,
	defaultGain,
	defaultBars,
	defaultBeats,
	defaultSteps,
	defaultPhrase,
	defaultInstrument,
	defaultVolume,
	barsIndex:             indexFrom(barsValues,   defaultBars),
	beatsIndex:            indexFrom(beatsValues,  defaultBeats),
	stepsIndex:            indexFrom(stepsValues,  defaultSteps),
	phraseIndex:           indexFrom(phraseValues, defaultPhrase),
	trackFormatSeparator,
	trackFormatAllocation,
	formatDigits,
});