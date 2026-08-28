export default class InterfaceDialogs {
	#ui;
	#bus;
	#modals         = [];
	#onCancel       = null;
	#toast          = document.querySelector('#toast');
	#toastMessage   = this.#toast.querySelector('p');
	#cancelButton   = this.#toast.querySelector('button');

	constructor({ bus, parent }) {
		this.#bus = bus;
		this.#ui = parent;
		document.addEventListener('click',           (event) => this.#dismissModal(event));
		document.addEventListener('cancel',          (event) => this.#cancelModal(event), { capture: true });
		document.addEventListener('toggle',          (event) => this.#setModal(event), { capture: true });
		this.#cancelButton.addEventListener('click', (event) => this.#cancelToast());
		this.#toast.addEventListener('animationend', (event) => this.#toast.hidePopover());
		this.#toast.addEventListener('toggle',       (event) => this.#clearCancel(event));
		this.#toastPositioning();
	}


	async #toastPositioning() {
		if (!CSS.supports('position-area', 'bottom')) {
			const { applyPolyfill } = await import('./polyfills/anchor-positioning.js');
			applyPolyfill(this.#toast, this.#ui.container);
		}
	}

	#dismissModal({ target }) {
		if (this.#modals.length > 0 && target.tagName === 'DIALOG' && 'dismiss' in target.dataset) {
			target.close();
		}
	}

	#setModal({ target, newState }) {
		if (target.tagName !== 'DIALOG') return;
		if (newState === 'open') {
			this.#modals.push(target);
			target.returnValue = '';
		} else {
			this.#modals = this.#modals.filter(modal => modal !== target);
			if (this.#modals.length > 0 && target.returnValue !== 'back') {
				this.#modals.forEach(modal => modal.close('back'));
			}
		}
	}

	#cancelModal(event) {
		event.preventDefault();
		event.target.close('back');
	}

	closeModal(modal) {
		if (this.#modals.length === 0) return;
		this.#modals.at(-1).close('back');
		modal.closed = true;
	}

	async #cancelToast() {
		if (!this.#onCancel) return;
		const { action, success, failure } = this.#onCancel;
		this.#toast.hidePopover();
		try {
			await action();
			this.showToast(success);
		} catch {
			this.showToast(failure);
		}
	}

	#clearCancel({ newState }) {
		if (newState === 'closed') this.#onCancel = null;
	}

	showToast(message, onCancel = null) {
		if (this.#onCancel && onCancel === null) return;
		this.#onCancel = onCancel;
		this.#toast.getAnimations().forEach(animation => animation.cancel() || animation.play());
		this.#toast.showPopover();
		requestAnimationFrame(() => {
			this.#toastMessage.textContent = message;
			this.#cancelButton.hidden = !onCancel;
		});
	}

}