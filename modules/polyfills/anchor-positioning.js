export function applyPolyfill(toast, anchor) {
	console.log('[Polyfill] CSS anchor positioning fallback applied');
	const observer = new ResizeObserver((entries) => toast.style.inset = `auto 1em max(0em, calc(100svh - ${entries[0].borderBoxSize[0].blockSize}px - 5em - var(--body-margin)))`);
	toast.addEventListener('beforetoggle', (event) => event.newState === 'open' ? observer.observe(anchor) : observer.unobserve(anchor));
}