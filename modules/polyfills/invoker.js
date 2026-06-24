if (!('commandForElement' in HTMLButtonElement.prototype)) {
	Object.defineProperty(HTMLButtonElement.prototype, 'commandForElement', {
		get() {
			const id = this.getAttribute('commandfor');
			return id ? document.getElementById(id) : null;
		},
		set(element) {
			if (element && element.id) {
				this.setAttribute('commandfor', element.id);
			}
		},
		configurable: true
	});
}

if (!('command' in HTMLButtonElement.prototype)) {
	Object.defineProperty(HTMLButtonElement.prototype, 'command', {
		get() {
			return this.getAttribute('command') || '';
		},
		set(value) {
			this.setAttribute('command', value);
		},
		configurable: true
	});
}


document.addEventListener('click', (event) => {
	const invoker = event.target.closest('[commandfor]');
	if (!invoker) return;

	const targetElement = invoker.commandForElement;
	const command = invoker.command;

	if (!targetElement || !command) return;

	const commandEvent = new CustomEvent('command', {
		bubbles: true,
		cancelable: true,
		detail: { command }
	});

	Object.defineProperties(commandEvent, {
		source: { value: invoker },
		command: { value: command }
	});

	const isNotCancelled = targetElement.dispatchEvent(commandEvent);

	if (isNotCancelled) {
		if (targetElement.tagName === 'DIALOG') {
			if (command === 'show-modal') {
				if (!targetElement.open) targetElement.showModal();
			} else if (command === 'close') {
				if (targetElement.open) targetElement.close();
			}
		}
	}
});