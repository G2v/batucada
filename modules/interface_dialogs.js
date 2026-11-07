export default class InterfaceDialogs {
	#toast;
	#toastMessage;
	#modals = [];
	#cancel = null;

	constructor({ config }) {

		const { selectors } = config;

		this.#toast             = document.querySelector(selectors.toast);
		this.#toastMessage      = document.querySelector(selectors.toastMessage);
		const toastCancelButton = document.querySelector(selectors.toastCancelButton);

		document.addEventListener('click',                (event) => this.#dismissModal(event));
		document.addEventListener('cancel',               (event) => InterfaceDialogs.#cancelModal(event), { capture: true });
		document.addEventListener('toggle',               (event) => this.#setModal(event), { capture: true });
		toastCancelButton.addEventListener('click',       (event) => this.#cancelToast());
		this.#toast.addEventListener('animationend',      (event) => this.#toast.hidePopover());
		this.#toast.addEventListener('toggle',            (event) => this.#clearCancel(event));
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

	static #cancelModal(event) {
		event.preventDefault();
		event.target.close('back');
	}

	closeModal(modal) {
		if (this.#modals.length === 0) return;
		this.#modals.at(-1).close('back');
		modal.closed = true;
	}

	async #cancelToast() {
		if (!this.#cancel) return;
		const { action, success, failure, invoker } = this.#cancel;
		this.#toast.hidePopover();
		invoker?.focus();
		try {
			await action();
			this.showToast(success);
		} catch {
			this.showToast(failure);
		}
	}

	#clearCancel({ newState }) {
		if (newState === 'closed') this.#cancel = null;
	}

	showToast(message, cancel = null) {
		this.#cancel = cancel;
		this.#toast.toggleAttribute('data-cancel', !!cancel);
		this.#toast.hidePopover();
		this.#toast.getAnimations();
		this.#toast.showPopover(cancel?.invoker && { source: cancel.invoker });
		requestAnimationFrame(() => this.#toastMessage.textContent = message);
	}
}
