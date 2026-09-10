function cloneIndexed(node, count, parent) {
	const label = node.ariaLabel.replace(/\s*\d+$/, '');
	for (let index = 1; index < count; index++) {
		const clone = node.cloneNode(true);
		clone.dataset.index = index;
		clone.ariaLabel = `${label} ${index + 1}`;
		parent.appendChild(clone);
	}
}

function cleanTemplates(root) {
	for (const element of [root, ...root.querySelectorAll('[data-template]')]) {
		for (const key in element.dataset) {
			if (key.startsWith('template')) delete element.dataset[key];
		}
	}
}

function instrumentRules(instruments, selectors) {
	const [first, ...rest] = instruments;
	let rules = `[data-instrument] { --icon-default: url('${first.strokes[0].icon}') }`;
	let maxStrokes = 0;

	for (const { id, strokes } of rest) {
		maxStrokes = Math.max(maxStrokes, strokes.length);
		const icons = strokes.map(({ icon }, j) => `--icon-${j + 1}: url('${icon}')`).join('; ');
		rules += `[data-instrument="${id}"] { ${icons} }`;
	}
	for (let j = 1; j <= maxStrokes; j++) {
		rules += `${selectors.stepButton}[value="${j}"] { --current-icon: var(--icon-${j}, var(--icon-default)) }`;
	}
	return rules;
}

export function buildStyles({ instrumentsLibraryReady, selectors }) {
	const stylesheet = new CSSStyleSheet();
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];

	return instrumentsLibraryReady.then(({ instruments }) => {
		stylesheet.replaceSync(instrumentRules(instruments, selectors));
	});
}

export function buildTracks(config, template) {
	const { tracksLength, selectors, resolution } = config;

	const masterTrack = template.cloneNode(true);
	const firstBar    = masterTrack.querySelector(selectors.bar);
	const firstBeat   = firstBar.querySelector(selectors.beat);

	cleanTemplates(firstBar);
	cloneIndexed(firstBeat, resolution.maxBeats, firstBar);
	cloneIndexed(firstBar, resolution.maxBars, firstBar.parentNode);
	cleanTemplates(masterTrack);

	const nodes = { tracks: [], instruments: [], volumes: [], steps: [] };
	const fragment = new DocumentFragment();

	for (let index = 0; index < tracksLength; index++) {
		const track  = masterTrack.cloneNode(true);
		const steps  = track.querySelectorAll(selectors.stepButton);

		track.dataset.index = index;
		steps[0].tabIndex = 0;

		nodes.tracks.push(track);
		nodes.instruments.push(track.querySelector(selectors.instrumentSelect));
		nodes.volumes.push(track.querySelector(selectors.volumeSlider));
		nodes.steps.push(...steps);
		fragment.appendChild(track);
	}

	return { nodes, fragment };
}

export function fillInstruments(config, nodes) {
	const instrumentKey = config.trackKeys.instrument;

	return config.instrumentsLibraryReady.then(({ instruments }) => {
		const values = instruments.slice(1);

		nodes.instruments.forEach((select, index) => {
			select.append(...values.map(({ name, id }) => new Option(name, id)));
			select.value = nodes.tracks[index].dataset[instrumentKey];
		});
	});
}