/** One execution segment: joiners receive its result, or the parent gets a completion wake-up. */
export class RunCompletion<T> {
	private completed = false;
	private value!: T;
	private waiters = new Set<{ resolve(value: T): void; detach(): void }>();
	claimed = false;

	get settled(): boolean { return this.completed; }
	/** Parent turns currently blocked on this segment. A queued prompt in the parent usually means one. */
	get waiting(): number { return this.waiters.size; }
	get result(): T {
		if (!this.completed) throw new Error("Run has not settled");
		return this.value;
	}

	settle(value: T): void {
		if (this.completed) throw new Error("Run already settled");
		this.value = value;
		this.completed = true;
		this.claimed = this.waiters.size > 0;
		for (const waiter of this.waiters) {
			waiter.detach();
			waiter.resolve(value);
		}
		this.waiters.clear();
	}

	wait(signal?: AbortSignal): Promise<T> {
		const cancelled = () => new DOMException("Wait cancelled; the child is unaffected.", "AbortError");
		if (signal?.aborted) return Promise.reject(cancelled());
		if (this.completed) {
			this.claimed = true;
			return Promise.resolve(this.value);
		}
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.waiters.delete(waiter);
				waiter.detach();
				reject(cancelled());
			};
			const waiter = { resolve, detach: () => signal?.removeEventListener("abort", abort) };
			this.waiters.add(waiter);
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
}
