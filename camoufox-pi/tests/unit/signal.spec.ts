import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { combineSignals } from "../../src/client/signal.js";

describe("combineSignals", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires when the external signal fires first", () => {
		const ctrl = new AbortController();
		const { signal, cleanup } = combineSignals(ctrl.signal, 1_000);
		expect(signal.aborted).toBe(false);
		ctrl.abort();
		expect(signal.aborted).toBe(true);
		cleanup();
	});

	it("fires when the timeout elapses first", () => {
		const ctrl = new AbortController();
		const { signal, cleanup } = combineSignals(ctrl.signal, 500);
		expect(signal.aborted).toBe(false);
		vi.advanceTimersByTime(500);
		expect(signal.aborted).toBe(true);
		cleanup();
	});

	it("returns a timeout-only signal when external is undefined", () => {
		const { signal, cleanup } = combineSignals(undefined, 500);
		expect(signal.aborted).toBe(false);
		vi.advanceTimersByTime(500);
		expect(signal.aborted).toBe(true);
		cleanup();
	});

	it("cleanup clears the timer", () => {
		const { signal, cleanup } = combineSignals(undefined, 500);
		cleanup();
		vi.advanceTimersByTime(1_000);
		expect(signal.aborted).toBe(false);
	});

	it("cleanup removes the external listener", () => {
		const ctrl = new AbortController();
		const { signal, cleanup } = combineSignals(ctrl.signal, 1_000_000);
		cleanup();
		ctrl.abort();
		expect(signal.aborted).toBe(false);
	});

	it("short-circuits when external is already aborted", () => {
		const ctrl = new AbortController();
		ctrl.abort();
		const { signal, cleanup } = combineSignals(ctrl.signal, 1_000);
		expect(signal.aborted).toBe(true);
		expect(() => cleanup()).not.toThrow();
		vi.advanceTimersByTime(1_000);
		// Timer must not keep the signal in some altered state; already aborted.
		expect(signal.aborted).toBe(true);
	});
});
