import { describe, expect, test } from "bun:test";
import { installTodo } from "../extensions/todo";
import { DEFAULT_CONFIG } from "../src/config";
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

describe("todo extension lifecycle", () => {
	test("tool updates the bounded widget, restores it after session navigation, and keeps collapsed history compact", async () => {
		const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
		let branchEntries = entries;
		const widgets: Array<{ key: string; content: WidgetFactory | undefined; options?: unknown }> = [];
		const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		let todoTool: any;
		const pi = {
			registerTool: (tool: unknown) => {
				todoTool = tool;
			},
			registerCommand: () => {},
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => events.set(event, handler),
			appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		};
		const ctx = {
			sessionManager: { getBranch: () => branchEntries },
			ui: {
				setWidget: (key: string, content: WidgetFactory | undefined, options?: unknown) =>
					widgets.push({ key, content, options }),
			},
		};

		installTodo(pi as never, DEFAULT_CONFIG);
		expect(todoTool.executionMode).toBe("sequential");
		expect(events.has("session_start")).toBe(true);
		expect(events.has("session_tree")).toBe(true);

		const added = await todoTool.execute(
			"todo-1",
			{ op: "add", phase: "Research", content: "Keep the current task visible" },
			undefined,
			undefined,
			ctx,
		);
		expect(widgets.at(-1)?.key).toBe("pi-omp.todo");
		expect(widgets.at(-1)?.options).toEqual({ placement: "aboveEditor" });
		expect(widgets.at(-1)?.content?.(undefined, plainTheme).render(80)).toContain(
			"  ☐ Keep the current task visible",
		);

		const compact = todoTool
			.renderResult(added, { expanded: false }, plainTheme, { isError: false })
			.render(80)
			.join("\n");
		expect(compact.trimEnd()).toBe("1 task remaining · pinned above editor");
		const expanded = todoTool
			.renderResult(added, { expanded: true }, plainTheme, { isError: false })
			.render(80)
			.join("\n");
		expect(expanded).toContain("Todo · 1 task · 1 open");

		await events.get("session_start")?.({}, ctx);
		await events.get("session_tree")?.({}, ctx);
		expect(widgets.filter((widget) => widget.content !== undefined)).toHaveLength(3);

		branchEntries = [
			{
				type: "custom",
				customType: "pi_omp.todo",
				data: { phases: [{ name: "Sibling", tasks: [{ content: "Use sibling task", status: "pending" }] }] },
			},
		];
		await events.get("session_tree")?.({}, ctx);
		expect(widgets.at(-1)?.content?.(undefined, plainTheme).render(80)).toContain("  ☐ Use sibling task");
		branchEntries = entries;

		const completed = await todoTool.execute(
			"todo-2",
			{ op: "done", content: "Keep the current task visible" },
			undefined,
			undefined,
			ctx,
		);
		expect(widgets.at(-1)).toEqual({ key: "pi-omp.todo", content: undefined, options: undefined });
		const completion = todoTool
			.renderResult(completed, { expanded: false }, plainTheme, { isError: false })
			.render(80)
			.join("\n");
		expect(completion.trimEnd()).toBe("All 1 task complete.");
	});
});
