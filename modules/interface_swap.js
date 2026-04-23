export default class InterfaceSwap {
	#ui;
	#bus;
	#order;
	#hasInstrument;
	#over          = new Set();
	#isActive      = false;
	#swapClass     = 'swap';
	#overClass     = 'over';
	#trashClass    = 'trash';
	#resetedClass  = 'reseted';
	#dropzoneClass = 'dropzone';
	#trash         = document.querySelector('#trash');

	constructor({ bus, parent }) {
		this.#bus   = bus;
		this.#ui    = parent;
		this.#order = Array.from({ length: parent.config.tracksLength }, (_, i) => i);
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
		//Déplacement du layout sur dragOver nécessaire sur firefox 149 à cause
		//d'un dragStart fantome sur un select à l'interieur d'un draggable
		this.#isActive = false;
		this.#hasInstrument = this.#ui.getTrackInstrument(track) !== this.#ui.config.defaultInstrument
		event.dataTransfer.setData('text/plain', track.dataset.index);
		event.dataTransfer.setDragImage(event.target, 0, 15);
		event.dataTransfer.effectAllowed = 'move';
	}

	#handleDragOver(event) {
		if (!this.#isActive) {
			this.#isActive = true;
			if (this.#hasInstrument) {
				this.#ui.container.classList.add(this.#swapClass);
			}
			this.#ui.container.classList.add(this.#trashClass);
		}
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
		this.#isActive = false;
		this.#ui.container.classList.remove(this.#swapClass, this.#trashClass);
		this.#removeOver();
	}

	#handleDrop(event) {
		this.#removeOver();
		const targetTrack  = this.#ui.getTrack(event.target);
		const targetIndex  = targetTrack ? this.#ui.getTrackIndex(targetTrack) : null;
		const sourceIndex  = Number(event.dataTransfer.getData('text/plain'));
		if (targetIndex !== null) {
			const sourcePosition = this.#order.indexOf(sourceIndex);
			const targetPosition = this.#order.indexOf(targetIndex);
			if (sourcePosition === targetPosition || sourcePosition + 1 === targetPosition) {
				return;
			}
		}
		const draggedTrack = this.#ui.tracks[sourceIndex];
		const trashed = targetIndex === null ? sourceIndex : null;
		const isLastVisualTrack = sourceIndex === this.#order.at(-1) || this.#ui.getTrackInstrument(draggedTrack) === this.#ui.config.defaultInstrument;
		this.#swapOrder(sourceIndex, targetIndex);
		const moveTrack = () => {
			draggedTrack.parentNode.insertBefore(draggedTrack, targetTrack);
			this.#bus.dispatchEvent(
				new CustomEvent('interface:moveTrack', { detail: { trashed, order: this.#order } })
			);
		};
		if (trashed !== null && isLastVisualTrack) {
			const target = draggedTrack.nextElementSibling || draggedTrack;
			moveTrack();
			target.classList.remove(this.#resetedClass);
			requestAnimationFrame(() => {
				target.classList.add(this.#resetedClass);
				target.addEventListener('animationend', () => target.classList.remove(this.#resetedClass), { once: true });
			});
		}
		else {
			document.startViewTransition(moveTrack);
		}
	}

	#isDropZone(target) {
		return this.#ui.container.classList.contains(this.#swapClass) 
			&& target.className === this.#dropzoneClass
			|| target === this.#trash;
	}

	#removeOver() {
		for (const target of this.#over) {
			target.classList.remove(this.#overClass);
		}
		this.#over.clear();
	}

	#swapOrder(sourceIndex, targetIndex) {
		const fromIndex = this.#order.indexOf(sourceIndex);
		const [item] = this.#order.splice(fromIndex, 1);
		const toIndex = targetIndex !== null ? this.#order.indexOf(targetIndex) : this.#ui.config.tracksLength;
		this.#order.splice(toIndex, 0, item);
	}
}

