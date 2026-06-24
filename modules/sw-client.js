export class SwClient {
	#bus;
	#registration;

	constructor({ bus }) {
		if (!('serviceWorker' in navigator)) return;

		this.#bus = bus;
		navigator.serviceWorker.addEventListener('message', ({ data }) => this.#readMessage(data));
		this.#bus.addEventListener('interface:install',     ({ detail }) => this.#install(detail));
		this.#bus.addEventListener('interface:findUpdate',  () => this.#findUpdate());

		if ('requestIdleCallback' in window) {
			requestIdleCallback(() => this.#init());
		} else {
			//fallback pour Safari
			setTimeout(() => this.#init(), 0);
		}
	}

	async #init() {
		this.#registration = await navigator.serviceWorker.register('./sw.js', { type: 'module' });
		this.#checkUpdate();
		this.#registration.addEventListener('updatefound', () => {
			const newWorker = this.#registration.installing;
			newWorker.addEventListener('statechange', () => {
				if (newWorker.state === 'installed') {
					this.#checkUpdate();
				}
			});
		});
	}

	#findUpdate() {
		this.#registration?.active.postMessage({ action: 'findUpdate' });
	}

	#checkUpdate() {
		// Si un service worker est en attente alors qu'un service worker est déja actif,
		// alors il s'agit une mise à jour.
		if (this.#registration.waiting && this.#registration.active) {
			queueMicrotask(() => {
				this.#bus.dispatchEvent(new CustomEvent('sw-client:newVersion'));
			});
		}
	}

	#readMessage({ type }) {
		if (type === 'update') {
			this.#bus.dispatchEvent(new CustomEvent('sw-client:install'));
		}
	}

	#install() {
		const { waiting } = this.#registration;
		if (waiting) {
			waiting.postMessage({ action: 'skipWaiting' });
			return;
		}
		this.#bus.dispatchEvent(new CustomEvent('sw-client:install'));
	}

}
