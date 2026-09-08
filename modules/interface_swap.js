
export default class InterfaceSwap {
	static #swapClass     = 'swap';
	static #overClass     = 'over';
	static #trashClass    = 'trash';
	static #resetedClass  = 'reseted';
	static #dropzoneClass = 'dropzone';

	#ui;
	#bus;
	#events;
	#trashZone;
	#trashSelector;
	#tracksLength;
	#defaultInstrument;
	#over = new Set();

	constructor({ bus, parent, config }) {
		this.#bus               = bus;
		this.#events            = config.events;
		this.#ui                = parent;
		this.#trashSelector     = config.selectors.trashZone;
		this.#trashZone         = document.querySelector(this.#trashSelector);
		this.#tracksLength      = config.tracksLength;
		this.#defaultInstrument = config.defaultInstrument;

		this.#ui.container.addEventListener('dragstart', (event) => this.#handleDragStart(event));
		this.#ui.container.addEventListener('dragenter', (event) => this.#handleDragEnter(event));
		this.#ui.container.addEventListener('dragover',  (event) => this.#handleDragOver(event));
		this.#ui.container.addEventListener('dragleave', (event) => this.#handleDragLeave(event));
		this.#ui.container.addEventListener('dragend',   (event) => this.#handleDragEnd(event));
		this.#ui.container.addEventListener('drop',      (event) => this.#handleDrop(event));
	}

	#handleDragStart(event) {
		const track = this.#ui.getTrack(event.target);
		if (!track) return;
		if (this.#ui.getTrackInstrument(track) !== this.#defaultInstrument) {
			this.#ui.container.classList.add(InterfaceSwap.#swapClass);
		}
		this.#ui.container.classList.add(InterfaceSwap.#trashClass);
		event.dataTransfer.setData('text/plain', track.dataset.index);
		event.dataTransfer.setDragImage(event.target, 0, 15);
		event.dataTransfer.effectAllowed = 'move';
	}

	#handleDragOver(event) {
		if (this.#isDropZone(event.target)) {
			event.preventDefault();
		}
	}

	#handleDragEnter(event) {
		this.#removeOver();
		if (!this.#isDropZone(event.target)) return;
		const target =
			event.target.closest(this.#trashSelector) ||
			this.#ui.getTrack(event.target);
		if (!target || this.#over.has(target)) return;
		this.#over.add(target);
		target.classList.add(InterfaceSwap.#overClass);
	}

	#handleDragLeave(event) {
		if (this.#isDropZone(event.target)) {
			this.#removeOver();
		}
	}

	#handleDragEnd(event) {
		this.#ui.container.classList.remove(InterfaceSwap.#swapClass, InterfaceSwap.#trashClass);
		this.#removeOver();
	}

	#handleDrop(event) {
		this.#removeOver();
		const targetTrack = this.#ui.getTrack(event.target);
		const targetIndex = targetTrack ? this.#ui.getTrackIndex(targetTrack) : null;
		const sourceIndex = Number(event.dataTransfer.getData('text/plain'));

		if (targetIndex !== null) {
			const sourcePosition = this.#ui.tracksOrder.indexOf(sourceIndex);
			const targetPosition = this.#ui.tracksOrder.indexOf(targetIndex);
			if (sourcePosition === targetPosition || sourcePosition + 1 === targetPosition) return;
		}

		if (targetIndex === null) {
			this.trashTrack(sourceIndex);
		} else {
			this.#ui.startViewTransition(() => this.moveTrack(sourceIndex, targetIndex));
		}
	}

	#isDropZone(target) {
		return this.#ui.container.classList.contains(InterfaceSwap.#swapClass)
			&& target.classList.contains(InterfaceSwap.#dropzoneClass)
			|| target === this.#trashZone;
	}

	#removeOver() {
		for (const target of this.#over) {
			target.classList.remove(InterfaceSwap.#overClass);
		}
		this.#over.clear();
	}

	#swapOrder(sourceIndex, targetIndex) {
		const fromIndex = this.#ui.tracksOrder.indexOf(sourceIndex);
		const [item] = this.#ui.tracksOrder.splice(fromIndex, 1);
		const toIndex = targetIndex !== null ? this.#ui.tracksOrder.indexOf(targetIndex) : this.#tracksLength;
		this.#ui.tracksOrder.splice(toIndex, 0, item);
	}

	moveTrack(sourceIndex, targetIndex) {
		if (sourceIndex === targetIndex) return;
		const draggedTrack = this.#ui.tracks[sourceIndex];
		const targetTrack  = targetIndex !== null ? this.#ui.tracks[targetIndex] : null;
		if (draggedTrack.nextElementSibling === targetTrack) return;
		const trashed = targetIndex === null ? sourceIndex : null;
		this.#swapOrder(sourceIndex, targetIndex);
		draggedTrack.parentNode.insertBefore(draggedTrack, targetTrack);
		this.#bus.dispatchEvent(new CustomEvent(this.#events.interfaceMoveTrack, {
			detail: { trashed, order: [...this.#ui.tracksOrder] }
		}));
	}

	trashTrack(sourceIndex) {
		const draggedTrack      = this.#ui.tracks[sourceIndex];
		const isLastVisualTrack = sourceIndex === this.#ui.tracksOrder.at(-1)
			|| this.#ui.getTrackInstrument(draggedTrack) === this.#defaultInstrument;

		if (isLastVisualTrack) {
			const target = draggedTrack.nextElementSibling || draggedTrack;
			this.moveTrack(sourceIndex, null);
			target.classList.remove(InterfaceSwap.#resetedClass);
			requestAnimationFrame(() => {
				target.classList.add(InterfaceSwap.#resetedClass);
				target.addEventListener('animationend', () => target.classList.remove(InterfaceSwap.#resetedClass), { once: true });
			});
		} else {
			this.#ui.startViewTransition(() => this.moveTrack(sourceIndex, null));
		}
	}
}
