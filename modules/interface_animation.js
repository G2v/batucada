export default class InterfaceAnimation {
	#ui;
	#queueLimit;
	#currentClass   = 'current';
	#finishedClass  = 'finished';
	#animationQueue = new Map();

	constructor({ parent }) {
		this.#ui = parent;
		this.#queueLimit = this.#ui.config.resolution.beat * 3;
	}

	start({ animations }) {
		//Supprime les pistes qui ne sont plus actives
		for (const [trackIndex, steps] of this.#animationQueue.entries()) {
			if (!animations.has(trackIndex)) {
				this.#animationQueue.delete(trackIndex);
				this.#ui.tracks[trackIndex].classList.add(this.#finishedClass);
				steps[0]?.step?.classList.remove(this.#currentClass);
				if (animations.size > 0) {
					this.#ui.tracks[trackIndex].classList.add(this.#finishedClass);
				}
			}
		}
		//Ajout des animations à la pile animationQueue
		for (const [trackIndex, items] of animations) {
			let steps = this.#animationQueue.get(trackIndex);
			// step fictif pour gérer la première animation
			if (!steps) {
				steps = [{ step: null, time: 0 }];
				this.#animationQueue.set(trackIndex, steps);
			}
			for (const { stepIndex, time } of items) {
				steps.push({ step: this.#ui.steps[stepIndex], time });
			}
			//Évite l'accumulation d'animations non exécutées (onglet inactif, latence)
			if (steps.length > this.#queueLimit) {
				steps.splice(1, steps.length - this.#queueLimit);
			}
		}
		this.#startLoop();
	}

	stop() {
		this.#ui.playing = false;
		for (const steps of this.#animationQueue.values()) {
			steps[0]?.step?.classList.remove(this.#currentClass);
		}
		this.#animationQueue.clear();
		for (const track of this.#ui.tracks) {
			track.classList.remove(this.#finishedClass);
		}
	}

	#startLoop() {
		if (!this.#ui.playing) {
			this.#ui.playing = true;
			requestAnimationFrame(this.#loop);
		}
	}

	#loop = () => {
		if (!this.#ui.playing) return;
		const now = performance.now();
		for (const steps of this.#animationQueue.values()) {
			if (steps.length < 2) continue;
			let nextIndex = 0;
			for (let i = steps.length - 1; i >= 1; i--) {
				if (now >= steps[i].time) {
					nextIndex = i;
					break;
				}
			}
			if (nextIndex === 0) continue;
			steps[0]?.step?.classList.remove(this.#currentClass);
			steps[nextIndex]?.step?.classList.add(this.#currentClass);
			steps.splice(0, nextIndex);
		}
		requestAnimationFrame(this.#loop);
	};

}
