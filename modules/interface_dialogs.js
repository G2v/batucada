export default class InterfaceDialogs {
	#toast;
	#toastMessage;
	#modals      = [];
	#cancel      = null;
	#returnFocus = null;

	constructor({ config }) {
		const { selectors } = config;

		this.#toast             = document.querySelector(selectors.toast);
		this.#toastMessage      = document.querySelector(selectors.toastMessage);
		const toastCancelButton = document.querySelector(selectors.toastCancelButton);

		document.addEventListener('cancel',            (event) => InterfaceDialogs.#cancelModal(event), { capture: true });
		document.addEventListener('toggle',            (event) => this.#setModal(event), { capture: true });
		toastCancelButton.addEventListener('click',    () => this.#cancelToast());
		this.#toast.addEventListener('animationend',   () => this.#toast.hidePopover());
		this.#toast.addEventListener('toggle',         (event) => this.#clearCancel(event));
		this.#toast.addEventListener('beforetoggle',   (event) => this.#restoreFocus(event));
		window.navigation.addEventListener('navigate', ({ navigationType }) => navigationType === 'traverse' && this.#closeAll());
	}

	#setModal({ target, newState }) {
		if (target.tagName !== 'DIALOG') return;
		if (newState === 'open') {
			this.#modals.push(target);
			target.returnValue = '';
		} else {
			this.#modals = this.#modals.filter(modal => modal !== target);
			if (target.returnValue !== 'back') this.#closeAll();
		}
	}

	#closeAll() {
		for (const modal of this.#modals.toReversed()) modal.close('back');
	}

	static #cancelModal(event) {
		if (event.target.closedBy === 'any') return;
		event.preventDefault();
		event.target.close('back');
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

	#restoreFocus({ newState }) {
		if (newState === 'closed' && this.#toast.matches(':focus-within')) this.#returnFocus.focus();
	}

	showToast(message, cancel = null) {
		this.#cancel = cancel;
		this.#toast.toggleAttribute('data-cancel', !!cancel);
		this.#toast.hidePopover();
		this.#returnFocus = document.activeElement;
		this.#toast.getAnimations();
		this.#toast.showPopover(cancel?.invoker && { source: cancel.invoker });
		requestAnimationFrame(() => this.#toastMessage.textContent = message);
	}
}