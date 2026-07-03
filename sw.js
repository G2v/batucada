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
	'./modules/navigation_worker.js',
	'./modules/presets.js',
	'./modules/utils.js',
	'./modules/sw-client.js',
	'./icons/icon.svg',
	'./icons/icon_512x512.png',
	'./icons/icon_white-bg.svg',
	'./icons/icon_white-bg_512x512.png',
	'./icons/favicon.svg',
];

let skipWaitingCalled = false;

self.addEventListener('message', async ({ data }) => {
	if (data?.action === 'skipWaiting') {
		skipWaitingCalled = true;
		self.skipWaiting();
	}
	if (data?.action === 'findUpdate') {
		await fetch('./version.js', { cache: 'reload' });
		self.registration.update();
	}
});

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(appCache).then(cache =>
			Promise.all(
				assets.map(path => {
					const url = new URL(path, self.registration.scope);
					const versionedUrl = new URL(url);
					versionedUrl.searchParams.set('v', version);
					return fetch(versionedUrl).then(response => cache.put(url.href, response));
				})
			)
		)
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys =>
				Promise.all(
					keys
						.filter(key => key !== appCache && key !== dataCache)
						.map(key => caches.delete(key))
				)
			)
			.then(async () => {
				await self.clients.claim();
				const clientsList = await self.clients.matchAll({ type: 'window' });
				const type = skipWaitingCalled ? 'update' : 'install';
				clientsList.forEach(client => client.postMessage({ type }));
			})
	);
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	const canonical = url.search
		? Object.assign(url, { search: '' }).href
		: url.href;
	event.respondWith(
		caches.match(event.request, { ignoreSearch: true, cacheName: appCache }).then(cached => {
			const networkFirst = event.request.cache === 'no-cache';
			if (cached && !networkFirst) return cached;
			return fetch(event.request)
				.then(response => {
					if (response.ok) {
						const responseClone = response.clone();
						caches.open(appCache).then(cache => cache.put(canonical, responseClone));
					}
					return response;
				})
				.catch(() => cached);
		})
	);
});