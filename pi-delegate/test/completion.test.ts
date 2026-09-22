import assert from "node:assert/strict";
import { test } from "node:test";
import { RunCompletion } from "../src/completion.ts";

const result = { status: "complete", output: "final report" };

test("attached waiters receive the same result and claim the completion wake-up", async () => {
	const completion = new RunCompletion<typeof result>();
	const first = completion.wait();
	const second = completion.wait();
	assert.equal(completion.settled, false);
	completion.settle(result);
	assert.equal(await first, result);
	assert.equal(await second, result);
	assert.equal(completion.claimed, true);
});

test("aborting the only wait leaves the run pending and its wake-up unclaimed", async () => {
	const completion = new RunCompletion<typeof result>();
	const controller = new AbortController();
	const waiting = completion.wait(controller.signal);
	controller.abort();
	await assert.rejects(waiting, { name: "AbortError", message: "Wait cancelled; the child is unaffected." });
	assert.equal(completion.settled, false);
	completion.settle(result);
	assert.equal(completion.result, result);
	assert.equal(completion.claimed, false);
});

test("cancelling one waiter does not detach another", async () => {
	const completion = new RunCompletion<typeof result>();
	const controller = new AbortController();
	const cancelled = completion.wait(controller.signal);
	const remaining = completion.wait();
	controller.abort();
	await assert.rejects(cancelled, { name: "AbortError" });
	completion.settle(result);
	assert.equal(await remaining, result);
	assert.equal(completion.claimed, true);
});

test("an already finished run returns the stored result without running work", async () => {
	const completion = new RunCompletion<typeof result>();
	completion.settle(result);
	assert.equal(completion.claimed, false);
	assert.equal(await completion.wait(), result);
	assert.equal(completion.claimed, true);
	assert.equal(await completion.wait(), result);
});

test("pre-aborted wait does not claim a finished completion", async () => {
	const completion = new RunCompletion<typeof result>();
	completion.settle(result);
	await assert.rejects(completion.wait(AbortSignal.abort()), { name: "AbortError" });
	assert.equal(completion.claimed, false);
});

test("completion wins over a subsequent abort", async () => {
	const completion = new RunCompletion<typeof result>();
	const controller = new AbortController();
	const waiting = completion.wait(controller.signal);
	completion.settle(result);
	controller.abort();
	assert.equal(await waiting, result);
	assert.equal(completion.claimed, true);
});

test("failed, timed-out, and cancelled runs return their terminal result", async () => {
	for (const status of ["error", "timeout", "cancelled"]) {
		const completion = new RunCompletion<typeof result>();
		const waiting = completion.wait();
		const failure = { status, output: "partial output" };
		completion.settle(failure);
		assert.equal(await waiting, failure);
	}
});

test("resuming uses a new completion, leaving earlier results intact", async () => {
	const first = new RunCompletion<typeof result>();
	first.settle(result);
	const second = new RunCompletion<typeof result>();
	const next = { status: "complete", output: "corrected report" };
	second.settle(next);
	assert.equal(await first.wait(), result);
	assert.equal(await second.wait(), next);
	assert.throws(() => first.settle(next), /already settled/);
});
