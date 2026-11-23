export default class InterfaceSwap {
	static #swapClass     = 'swap';
	static #overClass     = 'over';
	static #trashClass    = 'trash';
	static #resetedClass  = 'reseted';
	static #dropzoneClass = 'dropzone';

	#ui;
	#song;
	#trashZone;
	#endDropZone;
	#over = new Set();

	constructor({ parent, config, song }) {
		this.#ui                = parent;
		this.#song              = song;
		this.#trashZone         = document.querySelector(config.selectors.trashZone);
		this.#endDropZone       = document.querySelector(config.selectors.endDropZone);

		this.#ui.container.addEventListener('dragstart', (event) => this.#handleDragStart(event));
		this.#ui.container.addEventListener('dragenter', (event) => this.#handleDragEnter(event));
		this.#ui.container.addEventListener('dragover',  (event) => this.#handleDragOver(event));
		this.#ui.container.addEventListener('dragleave', (event) => this.#handleDragLeave(event));
		this.#ui.container.addEventListener('dragend',   () => this.#handleDragEnd());
		this.#ui.container.addEventListener('drop',      (event) => this.#handleDrop(event));
	}

	#handleDragStart(event) {
		const track = this.#ui.getTrack(event.target);
		if (!track) return;
		if (!this.#song.isEmpty(this.#ui.getTrackIndex(track))) {
			this.#ui.container.classList.add(InterfaceSwap.#swapClass);
		}
		this.#ui.container.classList.add(InterfaceSwap.#trashClass);
		event.dataTransfer.setData('text/plain', this.#ui.getTrackIndex(track));
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
		const target = event.target;
		if (this.#over.has(target)) return;
		this.#over.add(target);
		target.classList.add(InterfaceSwap.#overClass);
	}

	#handleDragLeave(event) {
		if (this.#isDropZone(event.target)) {
			this.#removeOver();
		}
	}

	#handleDragEnd() {
		this.#ui.container.classList.remove(InterfaceSwap.#swapClass, InterfaceSwap.#trashClass);
		this.#removeOver();
	}

	#handleDrop(event) {
		this.#removeOver();
		const targetTrack = this.#ui.getTrack(event.target);
		const sourceIndex = Number(event.dataTransfer.getData('text/plain'));

		if (event.target === this.#endDropZone) this.#moveTrack(sourceIndex, null);
		else if (targetTrack) this.#moveTrack(sourceIndex, this.#ui.getTrackIndex(targetTrack));
		else this.trashTrack(sourceIndex);
	}

	#moveTrack(sourceIndex, targetIndex) {
		const { order } = this.#song;
		if (sourceIndex === targetIndex || (order[order.indexOf(sourceIndex) + 1] ?? null) === targetIndex) return;
		this.#ui.startViewTransition(() => this.#song.moveTrack(sourceIndex, targetIndex), this.#ui.tracks[sourceIndex]);
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

	trashTrack(sourceIndex) {
		const draggedTrack      = this.#ui.tracks[sourceIndex];
		const isLastVisualTrack = sourceIndex === this.#song.order.at(-1) || this.#song.isEmpty(sourceIndex);
		if (isLastVisualTrack) {
			const target = draggedTrack.nextElementSibling || draggedTrack;
			this.#song.trashTrack(sourceIndex);
			target.classList.remove(InterfaceSwap.#resetedClass);
			requestAnimationFrame(() => {
				target.classList.add(InterfaceSwap.#resetedClass);
				target.addEventListener('animationend', () => target.classList.remove(InterfaceSwap.#resetedClass), { once: true });
			});
		} else {
			this.#ui.startViewTransition(() => this.#song.trashTrack(sourceIndex));
		}
	}
}