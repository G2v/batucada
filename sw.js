import version from './version.js';
import storage  from './config/storage.js';

const appCache = `${storage.appCache} ${version}`;
const dataCache = storage.dataCache;

const assets = [
	'./',
	'./version.js',
	'./share.html',
	'./manifest.json',
	'./config/about.js',
	'./config/storage.js',
	'./modules/audio.js',
	'./modules/audio_worker.js',
	'./modules/build-config.js',
	'./modules/interface.js',
	'./modules/interface_animation.js',
	'./modules/interface_app.js',
	'./modules/interface_aria.js',
	'./modules/interface_controls.js',
	'./modules/interface_dialogs.js',
	'./modules/interface_instruments.js',
	'./modules/interface_saved-songs.js',
	'./modules/interface_swap.js',
	'./modules/interface_tracks.js',
	'./modules/navigation.js',
	'./modules/saved-songs.js',
	'./modules/song.js',
	'./modules/song-url.js',
	'./modules/utils.js',
	'./icons/icon.svg',
	'./icons/icon_512x512.png',
	'./icons/icon_white-bg_512x512.png',
	'./icons/favicon.svg',
	storage.songsFile,
	storage.instrumentsSoundsFile,
	storage.instrumentsMetadataFile,
];

self.addEventListener('message', ({ data }) => {
	if (data?.action === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(appCache).then(cache =>
			cache.addAll(assets.map(path => new Request(new URL(path, self.registration.scope), { cache: 'no-cache' })))
		)
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(
				keys
					.filter(key => key !== appCache && key !== dataCache)
					.map(key => caches.delete(key))
			))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;
	const canonical = new URL(event.request.url);
	canonical.search = '';
	event.respondWith(
		caches.match(event.request, { ignoreSearch: true, cacheName: appCache }).then(cached => {
			const networkFirst = event.request.cache === 'no-cache' && event.request.destination === '';
			if (cached && !networkFirst) return cached;
			return fetch(event.request)
				.then(response => {
					if (response.ok) {
						const responseClone = response.clone();
						caches.open(appCache).then(cache => cache.put(canonical.href, responseClone));
					}
					return response;
				})
				.catch(() => cached);
		})
	);
});