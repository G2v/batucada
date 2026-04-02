window.navigation = new class extends EventTarget {
	get currentEntry() {
		return { getState: () => history.state };
	}
	
	navigate(url, options = {}) {
		const state = options.state ?? null;
		const absoluteUrl = new URL(url, location.origin).href;
		const navigateEvent = new Event('navigate');
		
		Object.assign(navigateEvent, {
			canIntercept: true,
			hashChange: false,
			downloadRequest: false,
			destination: {
				url: absoluteUrl,
				getState: () => state
			},
			navigationType: 'replace',
			intercept: (options) => {
				history.replaceState(state, '', absoluteUrl);
				if (options.handler) options.handler();
			}
		});
		this.dispatchEvent(navigateEvent);
	}
};
