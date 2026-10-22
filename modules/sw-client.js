import { defer } from './utils.js';

export class SwClient {
	#bus;
	#events;
	#registration;
	#updateRequested = false;

	constructor({ bus, config }) {
		if (!navigator.serviceWorker) return;

		this.#bus    = bus;
		this.#events = config.events;

		const hadController = Boolean(navigator.serviceWorker.controller);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (hadController || this.#updateRequested) location.reload();
		});

		this.#bus.addEventListener(this.#events.interfaceInstall,    () => this.#install());
		this.#bus.addEventListener(this.#events.interfaceFindUpdate, ({ detail }) => this.#findUpdate().then(detail.resolve, detail.reject));

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
		return Boolean(this.#registration?.waiting && this.#registration.active);
	}

	#checkUpdate() {
		if (this.#hasUpdate) this.#bus.dispatchEvent(new CustomEvent(this.#events.swClientNewVersion));
	}

	async #findUpdate() {
		this.#registration ??= await navigator.serviceWorker?.getRegistration();
		if (!this.#registration) return false;
		if (!this.#hasUpdate) {
			await this.#registration.update();
			const { installing } = this.#registration;
			if (installing) await new Promise(resolve => installing.addEventListener('statechange', resolve, { once: true }));
		}
		return this.#hasUpdate;
	}

	#install() {
		this.#updateRequested = true;
		const waiting = this.#registration?.waiting;
		if (waiting) waiting.postMessage({ action: 'skipWaiting' });
		else location.reload();
	}

}