export function applyPolyfill(toast, anchor) {
	console.log('[Polyfill] CSS anchor positioning fallback applied');
	const toasts = [toast];
	const stylesheet = new CSSStyleSheet();
	const selector = toasts.map(toast => `#${CSS.escape(toast.id)}`).join(', ');
	const ruleIndex = stylesheet.insertRule(`${selector} {}`, 0);
	const rule = stylesheet.cssRules[ruleIndex];
	const resizeObserver = new ResizeObserver((entries) => {
		const anchorHeight = entries[0].borderBoxSize[0].blockSize;
		rule.style.setProperty('--anchor-size-height', `${anchorHeight}px`);
	});
	document.adoptedStyleSheets.push(stylesheet);
	toasts.forEach(toast => {
		toast.addEventListener('beforetoggle', (event) => {
			event.newState === 'open' ? resizeObserver.observe(anchor) : resizeObserver.unobserve(anchor);
		});
	})
}