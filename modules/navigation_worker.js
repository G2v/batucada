import { encodeUrl, moveTrack } from './navigation_encode.js';

let config = null;

self.onmessage = ({ data: { action, payload } }) => {
	if (action === 'init') { config = payload.config; return; }
	if (!config) return;

	const searchParams = action === 'encode' ? encodeUrl(config, payload)
	                   : action === 'move'   ? moveTrack(config, payload)
	                   : null;

	if (searchParams) self.postMessage({ action: 'encoded', payload: searchParams });
};