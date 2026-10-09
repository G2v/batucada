export default class InterfaceAnimation {
	static #playedClass  = 'played';
	static #currentClass = 'current';

	#ui;
	#queueLimit;
	#emptyStroke;
	#playedSteps    = new Map();
	#lastPlayed     = new Map();
	#animationQueue = new Map();

	constructor({ parent, config }) {
		this.#ui          = parent;
		this.#queueLimit  = config.resolution.beat * 3;
		this.#emptyStroke = config.emptyStroke;
	}

	start({ animations }) {
		const endTime = animations.size
			? Math.min(...Array.from(animations.values(), items => items[0].time))
			: performance.now();
		for (const [trackIndex, steps] of this.#animationQueue) {
			if (animations.has(trackIndex) || steps.at(-1).end) continue;
			steps.push({ step: null, time: endTime, end: true });
		}
		//Ajout des animations à la pile animationQueue
		for (const [trackIndex, items] of animations) {
			let steps = this.#animationQueue.get(trackIndex);
			// La piste rejoue avant la fin prévue : on retire le repère de fin
			if (steps?.at(-1).end) steps.pop();
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
		delete this.#ui.container.dataset.playing;
		this.clear();
	}

	clear() {
		for (const steps of this.#animationQueue.values()) {
			steps[0]?.step?.classList.remove(InterfaceAnimation.#currentClass);
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
		const playedClass  = InterfaceAnimation.#playedClass;
		const currentClass = InterfaceAnimation.#currentClass;

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

			// Repère de fin atteint : toutes les cases de la piste sont passées (et marquées), on la retire
			if (steps[nextIndex].end) {
				this.#animationQueue.delete(trackIndex);
				this.#lastPlayed.delete(trackIndex);
				continue;
			}

			const nextStepIndex = steps[nextIndex].stepIndex;
			const lastStepIndex = this.#lastPlayed.get(trackIndex);
			if (lastStepIndex !== undefined && nextStepIndex <= lastStepIndex) {
				this.#clearPlayed(playedIndexes);
			}
			this.#lastPlayed.set(trackIndex, nextStepIndex);

			steps[nextIndex].step?.classList.add(currentClass);
			this.#ui.container.dataset.playing = this.#ui.tracks[trackIndex].dataset.phrase;
			steps.splice(0, nextIndex);
		}
		requestAnimationFrame(this.#loop);
	};

	#clearPlayed(playedIndexes) {
		for (let i = 0; i < playedIndexes.length; i++) {
			this.#ui.steps[playedIndexes[i]].classList.remove(InterfaceAnimation.#playedClass);
		}
		playedIndexes.length = 0;
	}
}