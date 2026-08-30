import { describe, expect, test } from "bun:test";
import { syncTodoWidget } from "../extensions/todo";
import { addTask, emptyState } from "../src/todo";
import type { TodoStyler } from "../src/todo-render";

const plainTheme: TodoStyler = {
	fg: (_color, text) => text,
	bold: (text) => text,
	strikethrough: (text) => text,
};

type WidgetFactory = (tui: unknown, theme: TodoStyler) => {
	render(width: number): string[];
	invalidate(): void;
};

describe("todo widget synchronization", () => {
	test("pins remaining tasks above the editor and clears after completion", () => {
		const calls: Array<{ key: string; content: WidgetFactory | undefined; options?: unknown }> = [];
		const ui = {
			setWidget(key: string, content: WidgetFactory | undefined, options?: unknown) {
				calls.push({ key, content, options });
			},
		};
		const state = addTask(emptyState(), "Research", "Trace the todo renderer");

		syncTodoWidget(ui as never, state);

		expect(calls[0]?.key).toBe("pi-omp.todo");
		expect(calls[0]?.options).toEqual({ placement: "aboveEditor" });
		expect(calls[0]?.content).toBeTypeOf("function");
		expect(calls[0]?.content?.(undefined, plainTheme).render(80).join("\n")).toContain(
			"└─ ☐ Trace the todo renderer",
		);

		syncTodoWidget(ui as never, emptyState());
		expect(calls[1]).toEqual({ key: "pi-omp.todo", content: undefined, options: undefined });
	});
});
