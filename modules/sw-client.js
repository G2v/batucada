import { defer } from './utils.js';

export class SwClient extends EventTarget {
	#registration;
	#updateRequested = false;

	constructor() {
		super();
		if (!navigator.serviceWorker) return;

		const hadController = Boolean(navigator.serviceWorker.controller);
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (hadController || this.#updateRequested) location.reload();
		});

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
		if (this.#hasUpdate) this.dispatchEvent(new Event('update'));
	}

	async findUpdate() {
		this.#registration ??= await navigator.serviceWorker?.getRegistration();
		if (!this.#registration) return false;
		if (!this.#hasUpdate) {
			await this.#registration.update();
			const { installing } = this.#registration;
			if (installing) await new Promise(resolve => installing.addEventListener('statechange', resolve, { once: true }));
		}
		return this.#hasUpdate;
	}

	install() {
		this.#updateRequested = true;
		const waiting = this.#registration?.waiting;
		if (waiting) waiting.postMessage({ action: 'skipWaiting' });
		else location.reload();
	}
}