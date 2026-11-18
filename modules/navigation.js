import { encodeSong, decodeSong, decodeTitle } from './song-url.js';

export class Navigation {
	#audio;
	#song;
	#config;
	#savedSongs;
	#searchParams;

	constructor({ config, song, savedSongs, audio }) {
		this.#audio           = audio;
		this.#song            = song;
		this.#config          = config;
		this.#savedSongs      = savedSongs;
		this.#searchParams    = new URLSearchParams(location.search);

		history.scrollRestoration = 'manual';
		this.#saveLastSequence();
		savedSongs.setCurrent(this.#current);

		navigation.addEventListener('currententrychange', () => this.#saveLastSequence());
		navigation.addEventListener('navigate',           event => this.#handleNavigation(event));
		song.addEventListener('change',                   ({ detail }) => this.#songChanged(detail));
	}

	openSavedSong(index) {
		const savedSong = this.#savedSongs.at(index);
		if (!savedSong) return;
		const { name, value, tempo } = savedSong;
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam, defaultSetValue } = this.#config;
		this.#searchParams.set(setSearchParam, value || defaultSetValue);
		this.#searchParams.set(titleSearchParam, name || '');
		if (this.#isDraft(navigation.currentEntry) && this.#isSameSavedSong(this.#previousEntry)) {
			navigation.back();
			return;
		}
		if (tempo) this.#searchParams.set(tempoSearchParam, tempo);
		else this.#searchParams.delete(tempoSearchParam);
		this.#searchParams.delete(volumeSearchParam);
		this.#navigate('decodeAll');
	}

	#saveLastSequence() {
		if (location.search) localStorage.lastSequence = location.search;
		else delete localStorage.lastSequence;
	}

	#songChanged(changes) {
		if (changes.reset) {
			this.#reset();
			return;
		}
		if (changes.transient || (changes.loaded && !changes.corrected)) return;
		const values = {};
		if (changes.steps.size) values.sheet   = true;
		if (!changes.loaded) {
			if (changes.tempo) values.tempo   = true;
			if (changes.title) values.title   = true;
			if (changes.tracks.size || changes.order)  values.tracks  = true;
			if (changes.volumes.size || changes.order) values.volumes = true;
		}
		if (Object.keys(values).length) this.#encodeURL(values);
	}

	#handleNavigation(event) {
		const { destination, navigationType, canIntercept, hashChange, downloadRequest } = event;
		const url = new URL(destination.url);
		const isTraverse = navigationType === 'traverse';

		if (navigationType === 'reload' ||
			url.protocol === 'blob:' ||
			!canIntercept ||
			hashChange ||
			downloadRequest) return;

		const action = isTraverse ? 'decodeAll' : event.info?.action;
		const sequenceChanged = action === 'decodeAll' && !this.#isSameSequence(destination);

		event.intercept({
			scroll: 'manual',
			focusReset: 'manual',
			handler: () => {
				if (!event.info?.keepState) {
					this.#searchParams = url.searchParams;
					if (action === 'reset' || action === 'decodeAll') {
						if (action === 'decodeAll') this.#song.load(decode(this.#config, this.#searchParams, this.#song.order));
						if (sequenceChanged) this.#audio.restart();
						if (sequenceChanged || action === 'reset') requestAnimationFrame(() => window.scrollTo(0, 0));
					}
				}
				this.#savedSongs.setCurrent(this.#current);
			}
		});
	}

	#encodeURL(values) {
		const replace = Object.keys(values).every(key => key === 'tempo' || key === 'volumes');
		const searchParams = encodeUrl(this.#config, { searchParams: this.#searchParams, song: this.#song, values });
		if (!searchParams) return;
		this.#searchParams = searchParams;
		this.#navigate('encoded', replace);
	}

	#reset() {
		const { setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam } = this.#config;
		for (const param of [setSearchParam, titleSearchParam, tempoSearchParam, volumeSearchParam]) {
			this.#searchParams.delete(param);
		}
		this.#navigate('reset');
	}

	#navigate(action, replace = false) {
		const nextUrl   = this.#url;
		const current   = navigation.currentEntry;
		const previous  = this.#previousEntry;
		const isDraft   = this.#isDraft(current);

		if ((replace || !isDraft) && current?.url === nextUrl) return;

		if (replace) {
			navigation.navigate(nextUrl, { history: 'replace', info: { action } });
			return;
		}

		if (isDraft && !this.#isDraft(previous)) {
			if (action === 'encoded' && this.#isSameSavedSong(previous)) {
				navigation.back({ info: { keepState: true } }).finished
					.then(() => this.#navigate(action, true), () => {});
				return;
			}
			if (previous?.url === nextUrl) {
				navigation.back();
				return;
			}
		}

		navigation.navigate(nextUrl, { history: isDraft ? 'replace' : 'push', info: { action } });
	}

	#isSameSavedSong(entry) {
		const params = URL.parse(entry?.url)?.searchParams;
		const { setSearchParam, titleSearchParam } = this.#config;
		return !!params && [setSearchParam, titleSearchParam].every(key => params.get(key) === this.#searchParams.get(key));
	}

	#isSameSequence(destination) {
		const { titleSearchParam } = this.#config;
		const title = URL.parse(destination.url)?.searchParams.get(titleSearchParam);
		return !!title && title === URL.parse(navigation.currentEntry?.url)?.searchParams.get(titleSearchParam);
	}

	#savedSongOf(searchParams) {
		const { setSearchParam, defaultSetValue } = this.#config;
		return {
			value: searchParams.get(setSearchParam) || defaultSetValue,
			name:  decodeTitle(this.#config, searchParams),
		};
	}

	get #current() {
		return this.#savedSongOf(this.#searchParams);
	}

	#isDraft(entry) {
		const searchParams = URL.parse(entry?.url)?.searchParams;
		if (!searchParams) return false;
		const savedSong = this.#savedSongOf(searchParams);
		return savedSong.value !== this.#config.defaultSetValue && this.#savedSongs.indexOf(savedSong) === -1;
	}

	get #previousEntry() {
		return navigation.entries()[navigation.currentEntry?.index - 1];
	}

	get #url() {
		const url = new URL(location.pathname, location.origin);
		url.search = this.#searchParams.toString();
		return url.href;
	}
}