export default class InterfaceSwap {
	#ui;
	#bus;
	#over          = new Set();
	#swapClass     = 'swap';
	#overClass     = 'over';
	#trashClass    = 'trash';
	#resetedClass  = 'reseted';
	#dropzoneClass = 'dropzone';
	#trash         = document.querySelector('#trash');

	constructor({ bus, parent }) {
		this.#bus   = bus;
		this.#ui    = parent;
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
		if (this.#ui.getTrackInstrument(track) !== this.#ui.config.defaultInstrument) {
			this.#ui.container.classList.add(this.#swapClass);
		}
		this.#ui.container.classList.add(this.#trashClass);
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
			event.target.closest(`#${this.#trash.id}`) ||
			this.#ui.getTrack(event.target);
		if (!target || this.#over.has(target)) return;
		this.#over.add(target);
		target.classList.add(this.#overClass);
	}

	#handleDragLeave(event) {
		if (this.#isDropZone(event.target)) {
			this.#removeOver();
		}
	}

	#handleDragEnd(event) {
		this.#ui.container.classList.remove(this.#swapClass, this.#trashClass);
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
			document.startViewTransition(() => this.moveTrack(sourceIndex, targetIndex));
		}
	}

	#isDropZone(target) {
		return this.#ui.container.classList.contains(this.#swapClass) 
			&& target.classList.contains(this.#dropzoneClass)
			|| target === this.#trash;
	}

	#removeOver() {
		for (const target of this.#over) {
			target.classList.remove(this.#overClass);
		}
		this.#over.clear();
	}

	#swapOrder(sourceIndex, targetIndex) {
		const fromIndex = this.#ui.tracksOrder.indexOf(sourceIndex);
		const [item] = this.#ui.tracksOrder.splice(fromIndex, 1);
		const toIndex = targetIndex !== null ? this.#ui.tracksOrder.indexOf(targetIndex) : this.#ui.config.tracksLength;
		this.#ui.tracksOrder.splice(toIndex, 0, item);
	}

	moveTrack(sourceIndex, targetIndex) {
		const draggedTrack = this.#ui.tracks[sourceIndex];
		const targetTrack  = targetIndex !== null ? this.#ui.tracks[targetIndex] : null;
		const trashed      = targetIndex === null ? sourceIndex : null;
		this.#swapOrder(sourceIndex, targetIndex);
		draggedTrack.parentNode.insertBefore(draggedTrack, targetTrack);
		this.#bus.dispatchEvent(
			new CustomEvent('interface:moveTrack', { detail: { trashed, order: this.#ui.tracksOrder } })
		);
	}

	trashTrack(sourceIndex) {
		const draggedTrack      = this.#ui.tracks[sourceIndex];
		const isLastVisualTrack = sourceIndex === this.#ui.tracksOrder.at(-1)
			|| this.#ui.getTrackInstrument(draggedTrack) === this.#ui.config.defaultInstrument;

		if (isLastVisualTrack) {
			const target = draggedTrack.nextElementSibling || draggedTrack;
			this.moveTrack(sourceIndex, null);
			target.classList.remove(this.#resetedClass);
			requestAnimationFrame(() => {
				target.classList.add(this.#resetedClass);
				target.addEventListener('animationend', () => target.classList.remove(this.#resetedClass), { once: true });
			});
		} else {
			document.startViewTransition(() => this.moveTrack(sourceIndex, null));
		}
	}

}
