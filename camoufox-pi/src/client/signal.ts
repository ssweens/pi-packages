// Combines an optional external AbortSignal with an internal timeout.
// Returns an AbortSignal plus a cleanup that clears the timer and the
// external-signal listener. Spec: §4.8, §5.4.

export interface CombinedSignal {
	readonly signal: AbortSignal;
	cleanup(): void;
}

export function combineSignals(
	external: AbortSignal | undefined,
	timeoutMs: number,
): CombinedSignal {
	const ctrl = new AbortController();

	const timer = setTimeout(() => {
		ctrl.abort();
	}, timeoutMs);

	let externalListener: (() => void) | undefined;
	if (external) {
		if (external.aborted) {
			ctrl.abort();
		} else {
			externalListener = () => ctrl.abort();
			external.addEventListener("abort", externalListener, { once: true });
		}
	}

	return {
		signal: ctrl.signal,
		cleanup: () => {
			clearTimeout(timer);
			if (external && externalListener) {
				external.removeEventListener("abort", externalListener);
			}
		},
	};
}
