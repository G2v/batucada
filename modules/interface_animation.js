export default class InterfaceAnimation {
	#ui;
	#queueLimit;
	#emptyStroke;
	#playedClass    = 'played';
	#currentClass   = 'current';
	#playedSteps    = new Map();
	#lastPlayed     = new Map();
	#animationQueue = new Map();

	constructor({ parent }) {
		this.#ui = parent;
		this.#queueLimit  = this.#ui.config.resolution.beat * 3;
		this.#emptyStroke = this.#ui.config.emptyStroke;
	}

	start({ animations }) {
		//Supprime les pistes qui ne sont plus actives
		for (const [trackIndex, steps] of this.#animationQueue.entries()) {
			if (!animations.has(trackIndex)) {
				this.#animationQueue.delete(trackIndex);
				this.#lastPlayed.delete(trackIndex);
				steps[0]?.step?.classList.remove(this.#currentClass);
			}
		}
		//Ajout des animations à la pile animationQueue
		for (const [trackIndex, items] of animations) {
			let steps = this.#animationQueue.get(trackIndex);
			// step fictif pour gérer la première animation
			if (!steps) {
				steps = [{ step: null, stepIndex: -1, time: 0 }];
				this.#animationQueue.set(trackIndex, steps);
				if (!this.#playedSteps.has(trackIndex)) {
					this.#playedSteps.set(trackIndex, []);
				}
			}
			for (const { stepIndex, time, stroke } of items) {
				steps.push({ step: this.#ui.steps[stepIndex], stepIndex, time, stroke });
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
		for (const playedIndexes of this.#playedSteps.values()) {
			this.#clearPlayed(playedIndexes);
		}
		this.#animationQueue.clear();
		this.#playedSteps.clear();
		this.#lastPlayed.clear();
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
		const playedClass  = this.#playedClass;
		const currentClass = this.#currentClass;

		for (const [trackIndex, steps] of this.#animationQueue) {
			if (steps.length < 2 || now < steps[1].time) continue;

			let nextIndex = 1;
			for (let i = 2; i < steps.length; i++) {
				if (now < steps[i].time) break;
				nextIndex = i;
			}

			const playedIndexes = this.#playedSteps.get(trackIndex);
			for (let i = 0; i < nextIndex; i++) {
				const { step, stepIndex, stroke } = steps[i];
				if (!step) continue;
				step.classList.remove(currentClass);
				if (stroke > this.#emptyStroke) {
					step.classList.add(playedClass);
					playedIndexes.push(stepIndex);
				}
			}

			const nextStepIndex = steps[nextIndex].stepIndex;
			const lastStepIndex = this.#lastPlayed.get(trackIndex);
			if (lastStepIndex !== undefined && nextStepIndex <= lastStepIndex) {
				this.#clearPlayed(playedIndexes);
			}
			this.#lastPlayed.set(trackIndex, nextStepIndex);

			steps[nextIndex].step?.classList.add(currentClass);
			steps.splice(0, nextIndex);
		}
		requestAnimationFrame(this.#loop);
	};

	#clearPlayed(playedIndexes) {
		for (let i = 0; i < playedIndexes.length; i++) {
			this.#ui.steps[playedIndexes[i]].classList.remove(this.#playedClass);
		}
		playedIndexes.length = 0;
	}
}