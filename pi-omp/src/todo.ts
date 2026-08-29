/**
 * Pure phased-todo state machine with Markdown round-trip.
 * Modeled on omp's `tools/todo.ts`. Immutable operations — each returns a new
 * state. Tasks are addressed by their content string (omp convention).
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface TodoItem {
	content: string;
	status: TodoStatus;
	blocker?: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoItem[];
}

export interface TodoState {
	phases: TodoPhase[];
}

export function emptyState(): TodoState {
	return { phases: [] };
}

/** Status glyph used in Markdown output. */
export const STATUS_MARK: Record<TodoStatus, string> = {
	pending: " ",
	in_progress: "/",
	completed: "x",
	abandoned: "~",
	blocked: "!",
};

export function markToStatus(mark: string): TodoStatus | undefined {
	for (const [status, m] of Object.entries(STATUS_MARK)) {
		if (m === mark) return status as TodoStatus;
	}
	return undefined;
}

export function countOpen(state: TodoState): number;
export function countOpen(items: TodoItem[]): number;
export function countOpen(stateOrItems: TodoState | TodoItem[]): number {
	const items = Array.isArray(stateOrItems) ? stateOrItems : stateOrItems.phases.flatMap((p) => p.tasks);
	return items.filter((t) => t.status === "pending" || t.status === "in_progress" || t.status === "blocked")
		.length;
}

export function findTask(state: TodoState, content: string): { phase: TodoPhase; task: TodoItem } | undefined {
	for (const phase of state.phases) {
		for (const task of phase.tasks) {
			if (task.content === content) return { phase, task };
		}
	}
	return undefined;
}

function mapState(state: TodoState, fn: (phase: TodoPhase) => TodoPhase): TodoState {
	return { phases: state.phases.map(fn) };
}

function mapTasks(state: TodoState, fn: (task: TodoItem) => TodoItem): TodoState {
	return mapState(state, (phase) => ({ name: phase.name, tasks: phase.tasks.map(fn) }));
}

/** Append a pending task to a phase (creating the phase if needed). */
export function addTask(state: TodoState, phaseName: string, content: string): TodoState {
	const phaseIdx = state.phases.findIndex((p) => p.name === phaseName);
	if (phaseIdx === -1) {
		return {
			phases: [...state.phases, { name: phaseName, tasks: [{ content, status: "pending" }] }],
		};
	}
	const phases = state.phases.map((phase, i) =>
		i === phaseIdx ? { ...phase, tasks: [...phase.tasks, { content, status: "pending" as const }] } : phase,
	);
	return { phases };
}

/**
 * Mark a task in_progress. If another task is already in_progress, it returns
 * to pending (omp keeps at most one in-flight task).
 */
export function startTask(state: TodoState, content: string): TodoState {
	const target = findTask(state, content);
	if (!target) return state;
	const targetPhaseName = target.phase.name;
	return mapState(state, (phase) => {
		if (phase.name !== targetPhaseName) return phase;
		return {
			name: phase.name,
			tasks: phase.tasks.map((t) => {
				if (t.content === content) return { ...t, status: "in_progress" };
				if (t.status === "in_progress") return { ...t, status: "pending" };
				return t;
			}),
		};
	});
}

/**
 * Mark a task complete. If no task is then in_progress, promote the earliest
 * remaining open (pending) task — omp's auto-promote behavior.
 */
export function completeTask(state: TodoState, content: string): TodoState {
	const target = findTask(state, content);
	if (!target) return state;
	const targetPhaseName = target.phase.name;
	let next = mapTasks(state, (t) =>
		t.content === content ? { ...t, status: "completed" as const, blocker: undefined } : t,
	);
	if (!next.phases.some((p) => p.tasks.some((t) => t.status === "in_progress"))) {
		// Promote earliest pending task (same phase first, then any phase).
		const candidate =
			next.phases.find((p) => p.name === targetPhaseName)?.tasks.find((t) => t.status === "pending") ??
			next.phases.flatMap((p) => p.tasks).find((t) => t.status === "pending");
		if (candidate) {
			next = mapTasks(next, (t) =>
				t.content === candidate.content ? { ...t, status: "in_progress" as const } : t,
			);
		}
	}
	return next;
}

/** Mark a task blocked and optionally record a blocker reason. */
export function blockTask(state: TodoState, content: string, blocker?: string): TodoState {
	return mapTasks(state, (t) => (t.content === content ? { ...t, status: "blocked", blocker } : t));
}

export function unblockTask(state: TodoState, content: string): TodoState {
	return mapTasks(state, (t) => (t.content === content ? { ...t, status: "pending", blocker: undefined } : t));
}

/** Drop (abandon) a task without deleting it. */
export function dropTask(state: TodoState, content: string): TodoState {
	return mapTasks(state, (t) => (t.content === content ? { ...t, status: "abandoned" } : t));
}

/** Remove a task entirely. */
export function removeTask(state: TodoState, content: string): TodoState {
	return {
		phases: state.phases
			.map((phase) => ({ name: phase.name, tasks: phase.tasks.filter((t) => t.content !== content) }))
			.filter((phase) => phase.tasks.length > 0),
	};
}

/** Render the state as a human-readable summary for the model. */
export function viewTasks(state: TodoState): string {
	const open = countOpen(state);
	const total = state.phases.reduce((n, p) => n + p.tasks.length, 0);
	const lines: string[] = [`Todos: ${open}/${total} open`];
	for (const phase of state.phases) {
		lines.push(`\n[${phase.name}]`);
		for (const t of phase.tasks) {
			const mark = STATUS_MARK[t.status];
			const blocker = t.status === "blocked" && t.blocker ? ` (blocked: ${t.blocker})` : "";
			lines.push(`- [${mark}] ${t.content}${blocker}`);
		}
	}
	return lines.join("\n");
}

/** Serialize the state to Markdown (round-trippable via markdownToPhases). */
export function phasesToMarkdown(state: TodoState): string {
	const lines: string[] = [];
	for (const phase of state.phases) {
		lines.push(`# ${phase.name}`);
		for (const t of phase.tasks) {
			const mark = STATUS_MARK[t.status];
			const blocker = t.blocker ? ` <!-- blocker: ${t.blocker} -->` : "";
			lines.push(`- [${mark}] ${t.content}${blocker}`);
		}
	}
	return lines.join("\n");
}

/** Parse Markdown produced by phasesToMarkdown (or hand-written). */
export function markdownToPhases(markdown: string): TodoState {
	const state: TodoState = { phases: [] };
	let current: TodoPhase | undefined;
	for (const rawLine of markdown.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (line.startsWith("# ")) {
			current = { name: line.slice(2).trim(), tasks: [] };
			state.phases.push(current);
			continue;
		}
		const m = line.match(/^\s*-\s*\[(.)\]\s+(.*)$/);
		if (!m) continue;
		let status: TodoStatus = markToStatus(m[1] ?? "") ?? "pending";
		let content = (m[2] ?? "").trim();
		let blocker: string | undefined;
		const bm = content.match(/^(.*?)\s*<!--\s*blocker:\s*(.*?)\s*-->\s*$/);
		if (bm) {
			content = bm[1]!.trim();
			blocker = bm[2]!.trim();
			if (status === "pending") status = "blocked";
		}
		if (!current) {
			current = { name: "Tasks", tasks: [] };
			state.phases.push(current);
		}
		current.tasks.push({ content, status, blocker });
	}
	return state;
}
