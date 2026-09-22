import version from './version.js'; 
import config  from './config/core.js';

const appCache = `${config.appCache} ${version}`;
const dataCache = config.dataCache;

const assets = [
	'./',
	'./index.html',
	'./version.js',
	'./share.html',
	'./manifest.json',
	'./config/app.js',
	'./config/core.js',
	'./data/instruments-metadata.json',
	'./data/instruments-sounds.json',
	'./data/presets.json',
	'./modules/audio.js',
	'./modules/audio_worker.js',
	'./modules/build-config.js',
	'./modules/build-dom.js',
	'./modules/interface.js',
	'./modules/interface_animation.js',
	'./modules/interface_app.js',
	'./modules/interface_aria.js',
	'./modules/interface_controls.js',
	'./modules/interface_dialogs.js',
	'./modules/interface_instruments.js',
	'./modules/interface_presets.js',
	'./modules/interface_swap.js',
	'./modules/navigation.js',
	'./modules/navigation_decode.js',
	'./modules/navigation_encode.js',
	'./modules/presets.js',
	'./modules/utils.js',
	'./modules/sw-client.js',
	'./icons/icon.svg',
	'./icons/icon_512x512.png',
	'./icons/icon_white-bg_512x512.png',
	'./icons/favicon.svg',
];

self.addEventListener('message', ({ data }) => {
	if (data?.action === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(appCache).then(cache =>
			// 'reload' contourne le cache HTTP ; addAll échoue si un fichier manque
			cache.addAll(assets.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))
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
			const networkFirst = event.request.cache === 'no-cache';
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