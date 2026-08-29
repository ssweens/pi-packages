import { describe, expect, test } from "bun:test";
import {
	addTask,
	blockTask,
	completeTask,
	dropTask,
	emptyState,
	markdownToPhases,
	phasesToMarkdown,
	removeTask,
	startTask,
	unblockTask,
	viewTasks,
} from "../src/todo";

describe("todo state machine", () => {
	test("addTask creates a phase and pending task", () => {
		const s = addTask(emptyState(), "Tasks", "scaffold crate");
		expect(s.phases).toHaveLength(1);
		expect(s.phases[0]!.tasks[0]).toEqual({ content: "scaffold crate", status: "pending" });
	});

	test("addTask appends to an existing phase", () => {
		let s = addTask(emptyState(), "Tasks", "a");
		s = addTask(s, "Tasks", "b");
		expect(s.phases[0]!.tasks.map((t) => t.content)).toEqual(["a", "b"]);
	});

	test("startTask marks a task in_progress and demotes any other in_progress", () => {
		let s = addTask(addTask(emptyState(), "T", "a"), "T", "b");
		s = startTask(s, "a");
		s = startTask(s, "b");
		expect(s.phases[0]!.tasks.find((t) => t.content === "a")!.status).toBe("pending");
		expect(s.phases[0]!.tasks.find((t) => t.content === "b")!.status).toBe("in_progress");
	});

	test("completeTask auto-promotes the earliest open task", () => {
		let s = addTask(addTask(addTask(emptyState(), "T", "a"), "T", "b"), "T", "c");
		s = completeTask(s, "a");
		expect(s.phases[0]!.tasks.find((t) => t.content === "a")!.status).toBe("completed");
		expect(s.phases[0]!.tasks.find((t) => t.content === "b")!.status).toBe("in_progress");
	});

	test("block/unblock set blocker", () => {
		let s = addTask(emptyState(), "T", "a");
		s = blockTask(s, "a", "waiting on API");
		expect(s.phases[0]!.tasks[0]).toMatchObject({ status: "blocked", blocker: "waiting on API" });
		s = unblockTask(s, "a");
		expect(s.phases[0]!.tasks[0]).toMatchObject({ status: "pending", blocker: undefined });
	});

	test("drop marks abandoned; rm removes", () => {
		let s = addTask(addTask(emptyState(), "T", "a"), "T", "b");
		s = dropTask(s, "a");
		expect(s.phases[0]!.tasks.find((t) => t.content === "a")!.status).toBe("abandoned");
		s = removeTask(s, "b");
		expect(s.phases[0]!.tasks.map((t) => t.content)).toEqual(["a"]);
	});
});

describe("todo markdown round-trip", () => {
	test("phasesToMarkdown then markdownToPhases preserves state", () => {
		let s = emptyState();
		s = addTask(s, "Foundation", "scaffold crate");
		s = startTask(s, "scaffold crate");
		s = addTask(s, "Foundation", "wire workspace");
		s = addTask(s, "🧪 Tests", "run tests");
		s = completeTask(s, "scaffold crate");
		s = addTask(s, "Foundation", "blocked task");
		s = blockTask(s, "blocked task", "waiting on API");

		const md = phasesToMarkdown(s);
		expect(md).toContain("# Foundation");
		expect(md).toContain("[x] scaffold crate");
		expect(md).toContain("<!-- blocker: waiting on API -->");
		expect(md).toContain("# 🧪 Tests");

		const parsed = markdownToPhases(md);
		expect(parsed).toEqual(s);
	});

	test("viewTasks reports open counts", () => {
		let s = addTask(addTask(emptyState(), "T", "a"), "T", "b");
		const view = viewTasks(s);
		expect(view).toContain("2/2 open");
		s = completeTask(s, "a");
		expect(viewTasks(s)).toContain("1/2 open");
	});
});
