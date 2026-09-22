import { defer } from './utils.js';

export class SwClient {
	#bus;
	#events;
	#registration;
	#updateRequested = false;

	constructor({ bus, config }) {
		if (!('serviceWorker' in navigator)) return;

		this.#bus = bus;
		this.#events = config.events;

		const hadController = Boolean(navigator.serviceWorker.controller);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (hadController || this.#updateRequested) location.reload();
		});

		this.#bus.addEventListener(this.#events.interfaceInstall,    () => this.#install());
		this.#bus.addEventListener(this.#events.interfaceFindUpdate, () => this.#findUpdate());

		defer(() => this.#init());
	}

	async #init() {
		this.#registration = await navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' });
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
		this.#registration.update().catch(() => {});
	}

	#install() {
		this.#updateRequested = true;
		const waiting = this.#registration?.waiting;
		if (waiting) waiting.postMessage({ action: 'skipWaiting' });
		else location.reload();
	}

}
