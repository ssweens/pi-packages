import { Type, type Static } from "typebox";
import * as fs from "node:fs/promises";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { todoPanelComponent, todoWidgetComponent } from "../src/todo-render";
import {
	type TodoState,
	addTask,
	blockTask,
	completeTask,
	countOpen,
	dropTask,
	emptyState,
	markdownToPhases,
	phasesToMarkdown,
	removeTask,
	startTask,
	unblockTask,
	viewTasks,
} from "../src/todo";

const TODO_CUSTOM_TYPE = "pi_omp.todo";
const TODO_WIDGET_KEY = "pi-omp.todo";

/** Structured details: the op plus the full state for the colored renderer. */
interface TodoToolDetails {
	op: TodoParams["op"];
	open: number;
	state: TodoState;
}

const PARAMS = Type.Object({
	op: Type.Union([
		Type.Literal("init"),
		Type.Literal("add"),
		Type.Literal("start"),
		Type.Literal("done"),
		Type.Literal("drop"),
		Type.Literal("block"),
		Type.Literal("unblock"),
		Type.Literal("rm"),
		Type.Literal("view"),
	]),
	phase: Type.Optional(Type.String()),
	content: Type.Optional(Type.String()),
	blocker: Type.Optional(Type.String()),
});
type TodoParams = Static<typeof PARAMS>;

/** Rehydrate state from the latest `pi_omp.todo` custom entry in the session. */
function loadState(sessionManager: ExtensionCommandContext["sessionManager"]): TodoState {
	const entries = sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i] as unknown as {
			type?: string;
			customType?: unknown;
			data?: unknown;
		};
		if (
			e.type === "custom" &&
			e["customType"] === TODO_CUSTOM_TYPE &&
			e["data"] &&
			typeof e["data"] === "object" &&
			Array.isArray((e["data"] as { phases?: unknown }).phases)
		) {
			return e["data"] as TodoState;
		}
	}
	return emptyState();
}

function applyOp(state: TodoState, p: TodoParams): TodoState {
	switch (p.op) {
		case "init":
			return emptyState();
		case "add":
			return addTask(state, p.phase ?? "Tasks", p.content ?? "");
		case "start":
			return startTask(state, p.content ?? "");
		case "done":
			return completeTask(state, p.content ?? "");
		case "drop":
			return dropTask(state, p.content ?? "");
		case "block":
			return blockTask(state, p.content ?? "", p.blocker);
		case "unblock":
			return unblockTask(state, p.content ?? "");
		case "rm":
			return removeTask(state, p.content ?? "");
		case "view":
		default:
			return state;
	}
}

export function syncTodoWidget(ui: Pick<ExtensionCommandContext["ui"], "setWidget">, state: TodoState): void {
	if (countOpen(state) === 0) {
		ui.setWidget(TODO_WIDGET_KEY, undefined);
		return;
	}
	ui.setWidget(TODO_WIDGET_KEY, (_tui, theme) => todoWidgetComponent(state, theme), {
		placement: "aboveEditor",
	});
}

function todoResultText(details: TodoToolDetails): string {
	const total = details.state.phases.reduce((count, phase) => count + phase.tasks.length, 0);
	if (total === 0) return "Task list cleared.";
	if (details.open === 0) return `All ${total} task${total === 1 ? "" : "s"} complete.`;
	return `${details.open} task${details.open === 1 ? "" : "s"} remaining · pinned above editor`;
}

export function installTodo(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	pi.registerTool({
		name: "todo",
		label: "Todos",
		description:
			"Manage a phased todo list. Ops: init, add (content, phase), start (content), done (content), drop/rm (content), block/unblock (content, blocker), view. Tasks are addressed by their content string; one task is in_progress; completing auto-promotes the next open task.",
		promptSnippet: "todo(op, content?, phase?, blocker?) — manage phased todos",
		parameters: PARAMS,
		executionMode: "sequential",
		execute: async (_toolCallId, params: TodoParams, _signal, _onUpdate, ctx) => {
			const state = applyOp(loadState(ctx.sessionManager), params);
			pi.appendEntry(TODO_CUSTOM_TYPE, state);
			syncTodoWidget(ctx.ui, state);
			const text = initOnly(params) ? "Todos cleared." : viewTasks(state);
			return {
				content: [{ type: "text", text }],
				details: { op: params.op, open: countOpen(state), state },
			};
		},
		// Compact header while the call streams in.
		renderCall: (args: TodoParams, theme) => {
			const op = args?.op ?? "view";
			const detail = args?.content ?? (args?.phase ? `phase: ${args.phase}` : "");
			return new Text(theme.fg("toolTitle", theme.bold("Todo")) + (detail ? theme.fg("dim", ` · ${op} ${detail}`) : ""), 0, 0);
		},
		// Expanded results preserve inspectable history; the live task surface is the widget.
		renderResult: (result, options, theme, context) => {
			const details = result?.details as TodoToolDetails | undefined;
			const state = details?.state;
			if (!details || !state || context?.isError) {
				return new Text(theme.fg("error", theme.bold("Todo")) + theme.fg("dim", " · failed"), 0, 0);
			}
			if (options.expanded) return todoPanelComponent(state, theme);
			return new Text(theme.fg(details.open === 0 ? "success" : "dim", todoResultText(details)), 0, 0);
		},
	});

	pi.on("session_start", (_event, ctx) => syncTodoWidget(ctx.ui, loadState(ctx.sessionManager)));
	pi.on("session_tree", (_event, ctx) => syncTodoWidget(ctx.ui, loadState(ctx.sessionManager)));

	pi.registerCommand("todo", {
		description:
			"pi-omp todos: /todo, /todo add <content>, /todo start|done|drop|rm <content>, /todo export [path], /todo import [path]",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			const state = loadState(ctx.sessionManager);
			switch (sub) {
				case "export": {
					const target = rest[0] ?? ctx.cwd + "/" + cfg.todo.file;
					await fs.writeFile(target, phasesToMarkdown(state), "utf8");
					ctx.ui.notify(`Todos exported to ${target}`, "info");
					return;
				}
				case "import": {
					const source = rest[0] ?? ctx.cwd + "/" + cfg.todo.file;
					const md = await fs.readFile(source, "utf8");
					const imported = markdownToPhases(md);
					pi.appendEntry(TODO_CUSTOM_TYPE, imported);
					syncTodoWidget(ctx.ui, imported);
					ctx.ui.notify(`Imported ${countOpen(imported)} open tasks from ${source}`, "info");
					return;
				}
				case "add": {
					const content = rest.join(" ");
					if (!content) {
						ctx.ui.notify("Usage: /todo add <task content>", "warning");
						return;
					}
					const next = addTask(state, cfg.todo.defaultPhase, content);
					pi.appendEntry(TODO_CUSTOM_TYPE, next);
					syncTodoWidget(ctx.ui, next);
					ctx.ui.notify(`Added: ${content}`, "info");
					return;
				}
				case "start":
				case "done":
				case "drop":
				case "rm": {
					const content = rest.join(" ");
					const fn =
						sub === "start" ? startTask : sub === "done" ? completeTask : sub === "drop" ? dropTask : removeTask;
					const next = fn(state, content);
					pi.appendEntry(TODO_CUSTOM_TYPE, next);
					syncTodoWidget(ctx.ui, next);
					ctx.ui.notify(`${sub}: ${content}`, "info");
					return;
				}
				case "":
				default: {
					const open = countOpen(state);
					syncTodoWidget(ctx.ui, state);
					ctx.ui.notify(`Todos: ${open} open across ${state.phases.length} phase(s).`, "info");
					return;
				}
			}
		},
	});
}

function initOnly(p: TodoParams): boolean {
	return p.op === "init";
}

/** Incomplete-work reminder (bounded; suppressed logic lives in index.ts's agent_end). */
export function todoReminderText(sessionManager: ExtensionCommandContext["sessionManager"]): string | undefined {
	const state = loadState(sessionManager);
	const open = countOpen(state);
	if (open === 0) return undefined;
	const inProgress = state.phases
		.flatMap((p) => p.tasks)
		.filter((t) => t.status === "in_progress")
		.map((t) => t.content);
	const heading = inProgress.length > 0 ? `In progress: ${inProgress.join(", ")}. ` : "";
	return `${heading}You stopped with ${open} open todo item(s). Continue working on them or mark them complete/finished.`;
}
