export class SwClient {
	#bus;
	#events;
	#registration;

	constructor({ bus, config }) {
		if (!('serviceWorker' in navigator)) return;

		this.#bus = bus;
		this.#events = config.events;
		navigator.serviceWorker.addEventListener('message', ({ data }) => this.#readMessage(data));
		this.#bus.addEventListener(this.#events.interfaceInstall,     ({ detail }) => this.#install(detail));
		this.#bus.addEventListener(this.#events.interfaceFindUpdate,  () => this.#findUpdate());

		if ('requestIdleCallback' in window) {
			requestIdleCallback(() => this.#init());
		} else {
			//fallback pour Safari
			setTimeout(() => this.#init(), 0);
		}
	}

	async #init() {
		this.#registration = await navigator.serviceWorker.register('./sw.js', { type: 'module' });
		this.#registration.addEventListener('updatefound', () => {
			const newWorker = this.#registration.installing;
			newWorker.addEventListener('statechange', () => {
				if (newWorker.state === 'installed') {
					this.#checkUpdate();
				}
			});
		});
	}

	get #hasUpdate() {
		// Si un service worker est en attente alors qu'un service worker est déja actif,
		// alors il s'agit une mise à jour.
		return Boolean(this.#registration?.waiting && this.#registration.active);
	}

	#checkUpdate() {
		if (this.#hasUpdate) this.#bus.dispatchEvent(new CustomEvent(this.#events.swClientNewVersion));
	}

	async #findUpdate() {
		this.#registration ??= await navigator.serviceWorker.ready;
		this.#checkUpdate();
		if (this.#hasUpdate) return;
		this.#registration.active.postMessage({ action: 'findUpdate' });
	}

	#readMessage({ type }) {
		if (type === 'update') {
			this.#bus.dispatchEvent(new CustomEvent(this.#events.swClientInstall));
		}
	}

	#install() {
		const waiting = this.#registration?.waiting;
		if (waiting) {
			waiting.postMessage({ action: 'skipWaiting' });
			return;
		}
		this.#bus.dispatchEvent(new CustomEvent(this.#events.swClientInstall));
	}

}
