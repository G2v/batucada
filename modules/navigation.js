import { encodeUrl, moveTrack } from './navigation_encode.js';
import { decode, decodeAll, initialState } from './navigation_decode.js';

export class Navigation {
	#bus;
	#state;
	#events;
	#config;
	#searchParams;
	#instrumentsBase;

	constructor({ bus, config }) {
		this.#bus          = bus;
		this.#config       = config;
		this.#events       = config.events;
		this.#state        = initialState(config);
		this.#searchParams = new URLSearchParams(location.search);
		this.#instrumentsBase = config.instrumentsLibraryReady.then(({ instruments }) =>
			Object.fromEntries(instruments.map(({ id, strokes }) => [id, strokes.length + 1]))
		);

		history.scrollRestoration = 'manual';

		navigation.addEventListener('navigate',                        event => this.#handleNavigation(event));
		this.#bus.addEventListener(this.#events.audioState,            ({ detail }) => this.#updateState(detail));
		this.#bus.addEventListener(this.#events.audioChanged,          ({ detail }) => this.#encodeURL(detail));
		this.#bus.addEventListener(this.#events.presetsUpdateData,     ({ detail }) => this.#presetsUpdated(detail));
		this.#bus.addEventListener(this.#events.presetsPresetSelected, ({ detail }) => this.#presetSelected(detail));
		this.#bus.addEventListener(this.#events.interfaceReset,        ({ detail }) => this.#reset());
		this.#bus.addEventListener(this.#events.interfaceMoveTrack,    ({ detail }) => this.#moveTrack(detail));
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

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: () => {
				this.#searchParams = url.searchParams;
				if (['reset', 'decode', 'decodeAll'].includes(action)) {
					window.scrollTo(0, 0);
					this.#decodeAction(action);
				}
				if (shouldDispatch) {
					this.#bus.dispatchEvent(new CustomEvent(this.#events.navigationChanged, { detail: new Map(this.#searchParams) }));
				}
			}
		});
	}

	#presetSelected({ name, value }) {
		const { setSearchParam, titleSearchParam, defaultSetValue, defaultTitleValue } = this.#config;
		this.#searchParams.set(setSearchParam, value || defaultSetValue);
		this.#searchParams.set(titleSearchParam, name || defaultTitleValue);
		this.#navigate({ action: 'decode', dispatch: true });
	}

	#presetsUpdated({ source, title }) {
		if (title !== undefined) this.#encodeURL({ title });
		if (source === 'set' || source === 'unset') this.#updateEntry(source === 'unset');
	}

	#updateEntry(isUnsaved) {
		const state = navigation.currentEntry?.getState() ?? {};
		if (!!state.isUnsaved === isUnsaved) return;
		navigation.updateCurrentEntry({ state: { ...state, isUnsaved } });
	}

	#encodeURL(values) {
		this.#updateState(values);
		this.#encode(encodeUrl, values);
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

	#navigate(state) {
		const current   = navigation.currentEntry;
		const nextUrl   = this.#url;
		const isUnsaved = !!current?.getState()?.isUnsaved;
		const previous  = navigation.entries()[(current?.index ?? -1) - 1];

		if (!isUnsaved && current?.url === nextUrl) return;

		if (isUnsaved && previous?.url === nextUrl && !previous.getState()?.isUnsaved) {
			navigation.back();
			return;
		}

		navigation.navigate(nextUrl, { history: isUnsaved ? 'replace' : 'push', state });
	}

	async #encode(encoder, values) {
		const instrumentsBase = await this.#instrumentsBase;
		const searchParams = encoder({ ...this.#config, instrumentsBase }, {
			searchParams: Object.fromEntries(this.#searchParams),
			state: this.#state,
			values,
		});
		if (!searchParams) return;
		this.#searchParams = new URLSearchParams(searchParams);
		this.#navigate({ action: 'encoded', dispatch: true });
	}

	get #url() {
		const url = new URL(location.pathname, location.origin);
		url.search = this.#searchParams.toString();
		return url.href;
	}

}