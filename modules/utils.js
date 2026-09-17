export function defer(task, timeout = 3000) {
	if (globalThis.scheduler?.postTask) {
		scheduler.postTask(task, { priority: 'background' }).catch(reportError);
	}
	else if ('requestIdleCallback' in globalThis) requestIdleCallback(task, { timeout });
	else setTimeout(task, 500);
}

export async function fetchFromCache(cacheName, filename, cacheResponse = false, eager = false) {
	const url     = new URL(filename, location.href).href;
	const network = eager ? fetch(url) : null;

	const cached = await caches.match(url, { cacheName }).catch(() => null);
	if (cached) {
		network?.then(response => response.body?.cancel()).catch(() => {});
		return cached;
	}

	const networkResponse = await (network ?? fetch(url));
	if (!networkResponse.ok) return networkResponse;

	const headers = new Headers(networkResponse.headers);
	headers.delete('last-modified');
	const response = new Response(networkResponse.body, { status: networkResponse.status, headers });

	if (cacheResponse) {
		const clone = response.clone();
		caches.open(cacheName).then(cache => cache.put(url, clone)).catch(() => {});
	}
	return response;
}

export async function writeData(cacheName, filename, data, addLastModified = true) {
	const cache = await caches.open(cacheName);
	const response = new Response(JSON.stringify(data), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			...(addLastModified && { 'Last-Modified': new Date().toUTCString() }),
		},
	});
	await cache.put(filename, response);
	return response;
}

export async function downloadFile(filename, content) {
	try {
		const handle = await window.showSaveFilePicker({
			startIn: 'downloads',
			suggestedName: filename,
			types: [{ accept: { 'application/json': ['.json'] } }],
		});
		const writable = await handle.createWritable();
		await writable.write(content);
		await writable.close();
		return true;
	}
	catch (error) {
		if (error.name === 'AbortError') return false;
		const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
		Object.assign(document.createElement('a'), { download: filename, href: url }).click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
		return true;
	}
}

export function getFileContent() {
	const { promise, resolve, reject } = Promise.withResolvers();
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json';
	input.addEventListener('cancel', () => reject(new DOMException('', 'AbortError')), { once: true });
	input.addEventListener('change', () => input.files[0].text().then(resolve, () => reject(new Error('read failed'))), { once: true });
	input.click();
	return promise;
}

