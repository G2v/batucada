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

export function buildStyles({ instrumentsLibrary, selectors }) {
	const [first, ...rest] = instrumentsLibrary.instruments;
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

	const stylesheet = new CSSStyleSheet();
	stylesheet.replaceSync(rules);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
}

export function buildTracks(config, template, trackList) {
	const { tracksLength, defaultInstrument, instrumentsLibrary, selectors, resolution } = config;

	const masterTrack = template.cloneNode(true);
	const firstBar    = masterTrack.querySelector(selectors.bar);
	const firstBeat   = firstBar.querySelector(selectors.beat);

	masterTrack.querySelector(selectors.instrumentSelect).append(
		...instrumentsLibrary.instruments.slice(1).map(({ name, id }) => new Option(name, id))
	);

	cleanTemplates(firstBar);
	cloneIndexed(firstBeat, resolution.maxBeats, firstBar);
	cloneIndexed(firstBar, resolution.maxBars, firstBar.parentNode);
	cleanTemplates(masterTrack);

	const nodes = { tracks: [], instruments: [], volumes: [], steps: [] };
	const fragment = new DocumentFragment();

	for (let index = 0; index < tracksLength; index++) {
		const track  = masterTrack.cloneNode(true);
		const select = track.querySelector(selectors.instrumentSelect);
		const steps  = track.querySelectorAll(selectors.stepButton);

		track.dataset.index = index;
		select.value = defaultInstrument;
		steps[0].tabIndex = 0;

		nodes.tracks.push(track);
		nodes.instruments.push(select);
		nodes.volumes.push(track.querySelector(selectors.volumeSlider));
		nodes.steps.push(...steps);
		fragment.appendChild(track);
	}

	trackList.appendChild(fragment);
	return nodes;
}