import { encodeUrl, moveTrack } from './navigation_encode.js';
import { decode, decodeAll, initialState } from './navigation_decode.js';

export class Navigation {
	static #entrySources = new Set(['save', 'import', 'cancel', 'clear']);

	#bus;
	#state;
	#events;
	#config;
	#searchParams;

	constructor({ bus, config }) {
		this.#bus             = bus;
		this.#config          = config;
		this.#events          = config.events;
		this.#state           = initialState(config);
		this.#searchParams    = new URLSearchParams(location.search);

		history.scrollRestoration = 'manual';
		this.#saveLastSequence();

		navigation.addEventListener('currententrychange',              () => this.#saveLastSequence());
		navigation.addEventListener('navigate',                        event => this.#handleNavigation(event));
		this.#bus.addEventListener(this.#events.audioState,            ({ detail }) => this.#updateState(detail));
		this.#bus.addEventListener(this.#events.audioChanged,          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener(this.#events.presetsUpdateData,     ({ detail }) => this.#presetsUpdated(detail));
		this.#bus.addEventListener(this.#events.presetsPresetSelected, ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener(this.#events.interfaceReset,        ({ detail }) => this.#reset());
		this.#bus.addEventListener(this.#events.interfaceMoveTrack,    ({ detail }) => this.#moveTrack(detail));
	}

	#saveLastSequence() {
		if (location.search) localStorage.lastSequence = location.search;
		else delete localStorage.lastSequence;
	}

	#updateState(values) {
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined && value !== null) {
				this.#state[key] = value;
			}
		}
	}

	#dispatchDecoded(changes) {
		this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationDecoded, { detail: changes }));
	}

	#decodeAction(action) {
		if (action === 'reset') {
			this.#state = initialState(this.#config, this.#state.order);
			return;
		}
		const decoder = action === 'decodeAll' ? decodeAll : decode;
		const changes = decoder(this.#config, this.#searchParams, this.#state);
		if (changes) this.#dispatchDecoded(changes);
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const state = destination.getState() || {};
		const isTraverse = navigationType === 'traverse';

		if (isTraverse) {
			const modal = { closed: false };
			this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationCloseModal, { detail: modal }));
			if (modal.closed) {
				event.preventDefault();
				return;
			}
		}

		if (navigationType === 'reload' ||
			url.protocol === 'blob:' ||
			!canIntercept ||
			hashChange ||
			downloadRequest) return;

		const action = isTraverse ? 'decodeAll' : state.action;
		const shouldDispatch = isTraverse || !!state.dispatch;
		const sequenceChanged = action === 'decodeAll' && !this.#isSameSequence(destination);
		const keepScroll = Boolean(event.info?.keepScroll);

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: () => {
				if (!event.info?.keepState) {
					this.#searchParams = url.searchParams;
					if (['reset', 'decode', 'decodeAll'].includes(action)) {
						this.#decodeAction(action);
						if (sequenceChanged) this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationSequenceChanged));
						if (!keepScroll) requestAnimationFrame(() => window.scrollTo(0, 0));
					}
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationChanged, { detail: new Map(this.#searchParams) }));
				}
			}
		});
	}

	#presetSelected({ name, value }) {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam, defaultSetValue } = this.#config;
		this.#searchParams.set(setSearchParam, value || defaultSetValue);
		this.#searchParams.set(titleSearchParam, name || '');
		if (this.#isUnsaved && this.#isSamePreset(this.#previousEntry)) {
			navigation.back();
			return;
		}
		this.#searchParams.delete(tempoSearchParam);
		this.#searchParams.delete(volumeSearchParam);
		this.#navigate({ action: 'decodeAll', dispatch: true });
	}

	#presetsUpdated({ source, title, index }) {
		if (title !== undefined) this.#encodeURL({ title });
		if (source === 'set' || source === 'unset') this.#updateEntry(source === 'unset');
		else if (title === undefined && index !== undefined && Navigation.#entrySources.has(source)) this.#updateEntry(index === -1);
	}

	#updateEntry(isUnsaved) {
		if (navigation.transition) {
			navigation.transition.finished.then(() => this.#updateEntry(isUnsaved), () => {});
			return;
		}
		if (this.#isUnsaved === isUnsaved) return;
		navigation.updateCurrentEntry({ state: { ...navigation.currentEntry?.getState(), isUnsaved } });
	}

	#encodeURL(values) {
		this.#updateState(values);
		const replace = Object.keys(values).every(key => key === 'tempo' || key === 'volumes');
		this.#encode(encodeUrl, values, replace);
	}

	#moveTrack(moved) {
		const previousOrder = this.#state.order;
		this.#state.order = moved.order;
		this.#encode(moveTrack, { ...moved, previousOrder });
	}

	#reset() {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam } = this.#config;
		for (const param of [setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam]) {
			this.#searchParams.delete(param);
		}
		this.#navigate({ action: 'reset', dispatch: false });
	}

	#navigate(state, replace = false) {
		const nextUrl   = this.#url;
		const current   = navigation.currentEntry;
		const previous  = this.#previousEntry;
		const isUnsaved = this.#isUnsaved;

		if ((replace || !isUnsaved) && current?.url === nextUrl) return;

		if (replace) {
			navigation.navigate(nextUrl, { history: 'replace', state: { ...current?.getState(), ...state } });
			return;
		}

		if (isUnsaved && !previous?.getState()?.isUnsaved) {
			if (state.action === 'encoded' && this.#isSamePreset(previous)) {
				navigation.back({ info: { keepState: true } }).finished
					.then(() => this.#navigate(state, true), () => {});
				return;
			}
			if (previous?.url === nextUrl) {
				navigation.back();
				return;
			}
		}

		navigation.navigate(nextUrl, { history: isUnsaved ? 'replace' : 'push', state });
	}

	#encode(encoder, values, replace = false) {
		const searchParams = encoder(this.#config, {
			searchParams: Object.fromEntries(this.#searchParams),
			state: this.#state,
			values,
		});
		if (!searchParams) return;
		this.#searchParams = new URLSearchParams(searchParams);
		this.#navigate({ action: 'encoded', dispatch: true }, replace);
	}

	#isSamePreset(entry) {
		const params = URL.parse(entry?.url)?.searchParams;
		const { setSearchParam, titleSearchParam } = this.#config;
		return !!params && [setSearchParam, titleSearchParam].every(key => params.get(key) === this.#searchParams.get(key));
	}

	#isSameSequence(destination) {
		const { titleSearchParam } = this.#config;
		const title = URL.parse(destination.url)?.searchParams.get(titleSearchParam);
		return !!title && title === URL.parse(navigation.currentEntry?.url)?.searchParams.get(titleSearchParam);
	}

	get #isUnsaved() {
		return !!navigation.currentEntry?.getState()?.isUnsaved;
	}

	get #previousEntry() {
		return navigation.entries()[navigation.currentEntry?.index - 1];
	}

	get #url() {
		const url = new URL(location.pathname, location.origin);
		url.search = this.#searchParams.toString();
		return url.href;
	}
}