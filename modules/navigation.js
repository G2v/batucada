import { encodeUrl, moveTrack } from './navigation_encode.js';
import { decode, decodeAll, initialState } from './navigation_decode.js';

export class Navigation {
	static #entrySources = new Set(['save', 'import', 'cancel', 'clear']);

	#bus;
	#state;
	#events;
	#config;
	#searchParams;
	#instrumentsBase;

	constructor({ bus, config }) {
		this.#bus             = bus;
		this.#config          = config;
		this.#events          = config.events;
		this.#state           = initialState(config);
		this.#searchParams    = new URLSearchParams(location.search);
		this.#instrumentsBase = config.instrumentsLibraryReady.then(({ instruments }) =>
			Object.fromEntries(instruments.map(({ id, strokes }) => [id, strokes.length + 1]))
		);

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
		const keepScroll = Boolean(event.info?.keepScroll);

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: () => {
				this.#searchParams = url.searchParams;
				if (['reset', 'decode', 'decodeAll'].includes(action)) {
					this.#decodeAction(action);
					if (!keepScroll) requestAnimationFrame(() => window.scrollTo(0, 0));
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationChanged, { detail: new Map(this.#searchParams) }));
				}
			}
		});
	}

	#presetSelected({ name, value }) {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam, defaultSetValue, defaultTitleValue } = this.#config;
		this.#searchParams.set(setSearchParam, value || defaultSetValue);
		this.#searchParams.set(titleSearchParam, name || defaultTitleValue);
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
		const state = navigation.currentEntry?.getState() ?? {};
		if (!!state.isUnsaved === isUnsaved) return;
		navigation.updateCurrentEntry({ state: { ...state, isUnsaved } });
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
		const current   = navigation.currentEntry;
		const nextUrl   = this.#url;
		const isUnsaved = !!current?.getState()?.isUnsaved;
		const previous  = navigation.entries()[(current?.index ?? -1) - 1];

		if ((replace || !isUnsaved) && current?.url === nextUrl) return;

		if (replace) {
			navigation.navigate(nextUrl, { history: 'replace', state: { ...current?.getState(), ...state } });
			return;
		}

		if (isUnsaved && previous?.url === nextUrl && !previous.getState()?.isUnsaved) {
			navigation.back({ info: { keepScroll: state.action === 'encoded' } });
			return;
		}

		navigation.navigate(nextUrl, { history: isUnsaved ? 'replace' : 'push', state });
	}

	async #encode(encoder, values, replace = false) {
		const instrumentsBase = await this.#instrumentsBase;
		const searchParams = encoder({ ...this.#config, instrumentsBase }, {
			searchParams: Object.fromEntries(this.#searchParams),
			state: this.#state,
			values,
		});
		if (!searchParams) return;
		this.#searchParams = new URLSearchParams(searchParams);
		this.#navigate({ action: 'encoded', dispatch: true }, replace);
	}

	get #url() {
		const url = new URL(location.pathname, location.origin);
		url.search = this.#searchParams.toString();
		return url.href;
	}
}