function cloneSteps(node, count, parent) {
	const label = node.ariaLabel.replace(/\s*\d+$/, '');
	for (let index = 1; index < count; index++) {
		const clone = node.cloneNode(true);
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

export function buildStyles({ instrumentsLibraryReady }) {
	const stylesheet = new CSSStyleSheet();
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];

	return instrumentsLibraryReady.then(({ instruments }) => {
		const [first, ...rest] = instruments;
		let rules = `.track [name="step"]:not([value="0"])::before { mask-image: url('${first.strokes[0].icon}') }`;
		for (const { id, strokes } of rest) {
			rules += strokes.map(({ icon }, j) => `.track[data-instrument="${id}"] [name="step"][value="${j + 1}"]::before { mask-image: url('${icon}') }`).join(' ');
		}
		stylesheet.replaceSync(rules);
	});
}

let masterTrack = null;

function buildMasterTrack({ selectors, resolution }, template) {
	const track     = template.cloneNode(true);
	const firstBar  = track.querySelector(selectors.bar);
	const firstBeat = firstBar.querySelector(selectors.beat);
	cleanTemplates(firstBar);
	cloneSteps(firstBeat, resolution.maxBeats, firstBar);
	cloneSteps(firstBar, resolution.maxBars, firstBar.parentNode);
	cleanTemplates(track);
	return track;
}

export function buildTracks(config, template, start = 0, end = config.tracksLength) {
	const { selectors } = config;

	masterTrack ??= buildMasterTrack(config, template);

	const nodes = { tracks: [], instruments: [], volumes: [], steps: [] };
	const fragment = new DocumentFragment();

	for (let count = end - start; count > 0; count--) {
		const track  = masterTrack.cloneNode(true);
		const steps  = track.querySelectorAll(selectors.stepButton);
		steps[0].tabIndex = 0;
		nodes.tracks.push(track);
		nodes.instruments.push(track.querySelector(selectors.instrumentSelect));
		nodes.volumes.push(track.querySelector(selectors.volumeSlider));
		nodes.steps.push(...steps);
		fragment.appendChild(track);
	}

	return { nodes, fragment };
}

export function buildInstruments(config, nodes) {
	return config.instrumentsLibraryReady.then(({ instruments }) => {
		const values = instruments.slice(1);
		nodes.instruments.forEach((select, index) => {
			select.append(...values.map(({ name, id }) => new Option(name, id)));
			select.value = nodes.tracks[index].dataset.instrument;
		});
	});
}