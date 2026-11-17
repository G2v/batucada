export default class InterfaceAnimation {
	static #playedClass  = 'played';
	static #currentClass = 'current';

	#ui;
	#queueLimit;
	#emptyStroke;
	#running        = false;
	#playedSteps    = new Map();
	#animationQueue = new Map();

	constructor({ parent, config, audio }) {
		this.#ui          = parent;
		this.#queueLimit  = config.resolution.beat * 3;
		this.#emptyStroke = config.emptyStroke;

		audio.addEventListener('animations', ({ detail }) => this.#start(detail));
		audio.addEventListener('restart',    () => this.#clear());
		audio.addEventListener('stop',       () => this.#stop());
	}

	#start({ animations }) {
		const endTime = animations.size
			? Math.min(...Array.from(animations.values(), items => items[0].time))
			: performance.now();
		for (const [trackIndex, steps] of this.#animationQueue) {
			if (animations.has(trackIndex) || steps.at(-1).end) continue;
			steps.push({ step: null, time: endTime, end: true });
		}
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
			// Évite l'accumulation d'animations non affichées (onglet inactif, latence)
			if (steps.length > this.#queueLimit) this.#advance(trackIndex, steps, steps.length - this.#queueLimit);
		}
		this.#startLoop();
	}

	#stop() {
		this.#running = false;
		delete this.#ui.container.dataset.playing;
		this.#clear();
	}

	#clear() {
		for (const steps of this.#animationQueue.values()) {
			steps[0]?.step?.classList.remove(InterfaceAnimation.#currentClass);
		}
		for (const playedIndexes of this.#playedSteps.values()) {
			this.#clearPlayed(playedIndexes);
		}
		this.#animationQueue.clear();
		this.#playedSteps.clear();
	}

	#startLoop() {
		if (!this.#running) {
			this.#running = true;
			requestAnimationFrame(this.#loop);
		}
	}

	#loop = () => {
		if (!this.#running) return;
		const now = performance.now();

		for (const [trackIndex, steps] of this.#animationQueue) {
			if (steps.length < 2 || now < steps[1].time) continue;

			let nextIndex = 1;
			for (let i = 2; i < steps.length; i++) {
				if (now < steps[i].time) break;
				nextIndex = i;
			}
			this.#advance(trackIndex, steps, nextIndex);
		}
		requestAnimationFrame(this.#loop);
	};

	#advance(trackIndex, steps, nextIndex) {
		const playedIndexes = this.#playedSteps.get(trackIndex);

		for (let i = 0; i < nextIndex; i++) {
			const { step, stepIndex, stroke } = steps[i];
			step?.classList.remove(InterfaceAnimation.#currentClass);
			if (step && stroke > this.#emptyStroke) {
				step.classList.add(InterfaceAnimation.#playedClass);
				playedIndexes.push(stepIndex);
			}
			// La case suivante revient en arrière : nouveau tour, les cases jouées sont effacées
			if (steps[i + 1].stepIndex <= stepIndex) this.#clearPlayed(playedIndexes);
		}

		if (steps[nextIndex].end) {
			this.#animationQueue.delete(trackIndex);
			return;
		}

		steps[nextIndex].step?.classList.add(InterfaceAnimation.#currentClass);
		this.#ui.container.dataset.playing = this.#ui.tracks[trackIndex].dataset.phrase;
		steps.splice(0, nextIndex);
	}

	#clearPlayed(playedIndexes) {
		for (let i = 0; i < playedIndexes.length; i++) {
			this.#ui.steps[playedIndexes[i]].classList.remove(InterfaceAnimation.#playedClass);
		}
		playedIndexes.length = 0;
	}
}