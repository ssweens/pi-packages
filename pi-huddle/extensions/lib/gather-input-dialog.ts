/**
 * GatherInputDialog - TUI component matching the Claude Code AskUserQuestion UI.
 */

import type { Component, Focusable } from "@mariozechner/pi-tui";
import { Input, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

// Inline block cursor: inverse-video character (used after typed text)
const BLOCK_CURSOR = "\x1b[7m \x1b[27m";
import type { Theme } from "@mariozechner/pi-coding-agent";

export interface QuestionOption {
	label: string;
	description: string;
	markdown?: string;
}

export interface QuestionDef {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

export interface GatherInputResult {
	answers: Record<string, string>;
	annotations: Record<string, { markdown?: string; notes?: string }>;
}

export type GatherInputDialogResult = GatherInputResult | { chatMode: true } | null;

const SUBMIT_VIEW = -1;

export class GatherInputDialog implements Component, Focusable {
	private questions: QuestionDef[];
	private theme: Theme;

	private currentQ = 0;
	private selectedIdx = 0;
	private submitIdx = 0;

	// Regular option selections: question → selected labels
	private selections = new Map<string, string[]>();
	// Freeform text per question
	private freeformValues = new Map<string, string>();
	// Questions where freeform was explicitly confirmed (Enter pressed)
	private confirmedFreeform = new Set<string>();
	private annotations = new Map<string, { markdown?: string }>();

	// Single Input instance — value swapped when switching questions
	private freeformInput: Input;

	// Focusable — kept so TUI recognises us, but we use inline BLOCK_CURSOR not CURSOR_MARKER
	private _focused = false;
	get focused(): boolean { return this._focused; }
	set focused(value: boolean) { this._focused = value; }

	onDone?: (result: GatherInputDialogResult) => void;

	constructor(questions: QuestionDef[], theme: Theme) {
		this.questions = questions;
		this.theme = theme;
		this.freeformInput = new Input();
		// No onSubmit/onEscape — we intercept keys in handleInput ourselves
	}

	private get currentQuestion(): QuestionDef | null {
		if (this.currentQ === SUBMIT_VIEW) return null;
		return this.questions[this.currentQ] ?? null;
	}

	private get isOnFreeform(): boolean {
		const q = this.currentQuestion;
		if (!q) return false;
		return this.selectedIdx === q.options.length;
	}

	private get chatIdx(): number {
		const q = this.currentQuestion;
		if (!q) return 0;
		return q.options.length + 1;
	}

	private get totalOptions(): number {
		const q = this.currentQuestion;
		if (!q) return 0;
		return q.options.length + 2; // options + freeform + chat
	}

	// ── Freeform helpers ──────────────────────────────────────────

	private saveFreeform(): void {
		const q = this.currentQuestion;
		if (!q) return;
		const val = this.freeformInput.getValue().trim();
		if (val) {
			this.freeformValues.set(q.question, val);
		} else {
			this.freeformValues.delete(q.question);
		}
	}

	private restoreFreeform(): void {
		const q = this.currentQuestion;
		if (!q) return;
		this.freeformInput.setValue(this.freeformValues.get(q.question) ?? "");
	}

	private clearFreeform(): void {
		const q = this.currentQuestion;
		if (!q) return;
		this.freeformValues.delete(q.question);
		this.confirmedFreeform.delete(q.question);
		this.freeformInput.setValue("");
	}

	// ── Answer state helpers ──────────────────────────────────────

	private isAnswered(q: QuestionDef): boolean {
		const sel = this.selections.get(q.question);
		return (!!sel && sel.length > 0) || this.confirmedFreeform.has(q.question);
	}

	// ── Navigation helpers ────────────────────────────────────────

	private setQuestion(idx: number): void {
		// Save freeform if leaving a question on the freeform row
		if (this.currentQ !== SUBMIT_VIEW && this.isOnFreeform) {
			this.saveFreeform();
		}
		this.currentQ = idx;
		this.selectedIdx = 0;
		// If landing on a question and its freeform was previously filled, restore
		if (this.currentQ !== SUBMIT_VIEW) {
			this.freeformInput.setValue(this.freeformValues.get(this.currentQuestion!.question) ?? "");
			this.freeformInput.focused = false;
		}
	}

	private setSelectedIdx(idx: number): void {
		const wasOnFreeform = this.isOnFreeform;
		if (wasOnFreeform) this.saveFreeform();

		this.selectedIdx = idx;

		if (this.isOnFreeform) {
			this.restoreFreeform();
		} else {
			this.freeformInput.focused = false;
		}
	}

	private goNext(): void {
		if (this.currentQ === SUBMIT_VIEW) {
			this.setQuestion(0);
		} else if (this.currentQ < this.questions.length - 1) {
			this.setQuestion(this.currentQ + 1);
		} else {
			if (this.isOnFreeform) this.saveFreeform();
			this.currentQ = SUBMIT_VIEW;
			this.selectedIdx = 0;
			this.submitIdx = 0;
		}
	}

	private goPrev(): void {
		if (this.currentQ === SUBMIT_VIEW) {
			this.setQuestion(this.questions.length - 1);
		} else if (this.currentQ === 0) {
			if (this.isOnFreeform) this.saveFreeform();
			this.currentQ = SUBMIT_VIEW;
			this.selectedIdx = 0;
			this.submitIdx = 0;
		} else {
			this.setQuestion(this.currentQ - 1);
		}
	}

	// ── Selection logic ───────────────────────────────────────────

	private selectCurrentOption(): void {
		if (this.currentQ === SUBMIT_VIEW) {
			if (this.submitIdx === 0) this.doSubmit();
			else this.onDone?.(null);
			return;
		}

		const q = this.currentQuestion!;
		const qKey = q.question;
		const freeformIdx = q.options.length;

		if (this.selectedIdx === freeformIdx) {
			// Enter on freeform = confirm the typed value
			const val = this.freeformInput.getValue().trim();
			if (val) {
				this.saveFreeform();
				this.confirmedFreeform.add(qKey);
				if (!q.multiSelect) this.goNext();
			}
			return;
		}

		if (this.selectedIdx === this.chatIdx) {
			this.onDone?.({ chatMode: true });
			return;
		}

		const opt = q.options[this.selectedIdx];
		if (q.multiSelect) {
			const current = this.selections.get(qKey) ?? [];
			const idx = current.indexOf(opt.label);
			if (idx >= 0) {
				current.splice(idx, 1);
				this.selections.set(qKey, [...current]);
			} else {
				this.selections.set(qKey, [...current, opt.label]);
				if (opt.markdown) this.annotations.set(qKey, { markdown: opt.markdown });
			}
		} else {
			this.selections.set(qKey, [opt.label]);
			if (opt.markdown) this.annotations.set(qKey, { markdown: opt.markdown });
			// Clear freeform if a real option was chosen
			this.clearFreeform();
			this.goNext();
		}
	}

	private doSubmit(): void {
		const answers: Record<string, string> = {};
		const annotations: Record<string, { markdown?: string }> = {};
		for (const q of this.questions) {
			const sel = this.selections.get(q.question);
			// Only include freeform if explicitly confirmed with Enter
			const freeform = this.confirmedFreeform.has(q.question)
				? this.freeformValues.get(q.question)
				: undefined;
			const parts: string[] = [];
			if (sel && sel.length > 0) parts.push(...sel);
			if (freeform) parts.push(freeform);
			answers[q.question] = parts.length > 0 ? parts.join(", ") : "(skipped)";
			const ann = this.annotations.get(q.question);
			if (ann) annotations[q.question] = ann;
		}
		this.onDone?.({ answers, annotations });
	}

	// ── Input handling ────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.currentQ === SUBMIT_VIEW) {
			if (matchesKey(data, Key.up))                                 this.submitIdx = Math.max(0, this.submitIdx - 1);
			else if (matchesKey(data, Key.down))                          this.submitIdx = Math.min(1, this.submitIdx + 1);
			else if (matchesKey(data, Key.enter))                         this.selectCurrentOption();
			else if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) this.goNext();
			else if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) this.goPrev();
			else if (matchesKey(data, Key.escape))                        this.onDone?.(null);
			return;
		}

		// Universal cancel
		if (matchesKey(data, Key.escape)) {
			this.onDone?.(null); return;
		}

		// Tab / Shift+Tab are the canonical "leave this field" keys for forms
		// and always navigate between questions — even when the freeform input
		// has focus. Users who want to leave the freeform field press Tab.
		if (matchesKey(data, Key.tab)) {
			this.goNext(); return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.goPrev(); return;
		}

		// On the freeform row — only Up/Down (row navigation) and Enter (confirm)
		// are handled here. EVERY other key (Left, Right, Home, End, Ctrl+A,
		// Ctrl+E, Ctrl+W, Alt+Left/Right word jumps, Ctrl+U/K line kills,
		// Ctrl+Z undo, Backspace, Delete, printable characters, etc.) is
		// forwarded to pi-tui's Input component, which natively supports the
		// full editor keybinding set via the `tui.editor.*` keybindings.
		// Previously Left/Right were intercepted by this handler for inter-
		// question navigation, which broke ALL cursor movement inside the
		// freeform input. Use Tab/Shift+Tab to move between questions instead.
		if (this.isOnFreeform) {
			if (matchesKey(data, Key.up)) {
				this.setSelectedIdx(this.selectedIdx - 1);
			} else if (matchesKey(data, Key.down)) {
				this.setSelectedIdx(this.selectedIdx + 1);
			} else if (matchesKey(data, Key.enter)) {
				this.selectCurrentOption();
			} else {
				this.freeformInput.handleInput(data);
				// Keep freeformValues in sync live
				this.saveFreeform();
			}
			return;
		}

		// Non-freeform rows: Left/Right navigate between questions, Up/Down
		// navigate between options within a question, Enter selects.
		if (matchesKey(data, Key.right)) {
			this.goNext(); return;
		}
		if (matchesKey(data, Key.left)) {
			this.goPrev(); return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.selectedIdx > 0) this.setSelectedIdx(this.selectedIdx - 1);
		} else if (matchesKey(data, Key.down)) {
			if (this.selectedIdx < this.totalOptions - 1) this.setSelectedIdx(this.selectedIdx + 1);
		} else if (matchesKey(data, Key.enter)) {
			this.selectCurrentOption();
		}
	}

	invalidate(): void {
		this.freeformInput.invalidate?.();
	}

	// ── Rendering ─────────────────────────────────────────────────

	render(width: number): string[] {
		const t = this.theme;
		const lines: string[] = [];

		// ── Tab bar ──────────────────────────────────────────────
		const tabParts: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const q = this.questions[i];
			const isActive = i === this.currentQ;
			const isDone = this.isAnswered(q);
			const icon = isDone ? "☒" : "□";
			const label = `${icon} ${q.header}`;
			tabParts.push(isActive
				? t.bg("selectedBg", ` ${t.bold(label)} `)
				: t.fg("muted", ` ${label} `));
		}
		const submitActive = this.currentQ === SUBMIT_VIEW;
		tabParts.push(submitActive
			? t.bg("selectedBg", t.bold(" ✓ Submit "))
			: t.fg("dim", " ✓ Submit "));

		lines.push(truncateToWidth(`← ${tabParts.join("")} →`, width));
		lines.push("");

		// ── Submit view ──────────────────────────────────────────
		if (this.currentQ === SUBMIT_VIEW) {
			lines.push(t.bold("Review your answers"));
			lines.push("");

			const unanswered = this.questions.filter((q) => !this.isAnswered(q));
			if (unanswered.length > 0) {
				lines.push(t.fg("warning", "⚠ You have not answered all questions"));
				lines.push("");
			}

			for (const q of this.questions) {
				const sel = this.selections.get(q.question) ?? [];
				const freeform = this.confirmedFreeform.has(q.question)
					? this.freeformValues.get(q.question)
					: undefined;
				const parts = [...sel, ...(freeform ? [freeform] : [])];
				if (parts.length > 0) {
					// Wrap the recap question text so long questions don't get clipped
					// on the right edge. First line gets the bullet prefix; continuation
					// lines align with the question text (4 spaces).
					const qWidth = Math.max(10, width - 4);
					const wrappedQuestion = wrapTextWithAnsi(q.question, qWidth);
					for (let i = 0; i < wrappedQuestion.length; i++) {
						const prefix = i === 0 ? "  ● " : "    ";
						lines.push(`${prefix}${wrappedQuestion[i]}`);
					}

					// Wrap the recap answer text similarly. The arrow + 6-space
					// continuation keep the visual hierarchy intact across wraps.
					const answerText = parts.join(", ");
					const aWidth = Math.max(10, width - 6);
					const wrappedAnswer = wrapTextWithAnsi(answerText, aWidth);
					for (let i = 0; i < wrappedAnswer.length; i++) {
						const body = i === 0 ? `→ ${wrappedAnswer[i]}` : `  ${wrappedAnswer[i]}`;
						lines.push(`    ${t.fg("accent", body)}`);
					}
					lines.push("");
				}
			}

			lines.push(t.fg("muted", "Ready to submit your answers?"));
			lines.push("");
			lines.push("  " + (this.submitIdx === 0
				? t.fg("accent", `> 1. ${t.bold("Submit answers")}`)
				: `  1. ${t.bold("Submit answers")}`));
			lines.push("  " + (this.submitIdx === 1
				? t.fg("accent", "> 2. Cancel")
				: "  2. Cancel"));
			lines.push("");
			lines.push(t.fg("dim", "Enter to select · ←/→ or Tab to go back · Esc to cancel"));
			return lines.map((l) => truncateToWidth(l, width));
		}

		// ── Question view ────────────────────────────────────────
		const q = this.currentQuestion!;
		const freeformIdx = q.options.length;
		const checkedLabels = this.selections.get(q.question) ?? [];
		const freeformValue = this.freeformValues.get(q.question) ?? "";

		for (const line of wrapTextWithAnsi(t.bold(q.question), width - 2)) {
			lines.push(line);
		}
		lines.push("");

		// Visible prefix before label text is always 7 chars:
		//   "  " (outer indent) + "> " or "  " (cursor marker) + "N. " (number + dot + space)
		// Wrap label and description against (width - 7) and pad continuation
		// lines with 7 spaces so the wrapped text stays aligned under itself.
		const LABEL_INDENT = 7;
		const labelContentWidth = Math.max(10, width - LABEL_INDENT);
		const LABEL_PADDING = " ".repeat(LABEL_INDENT);

		for (let i = 0; i < q.options.length; i++) {
			const opt = q.options[i];
			const isCursor = i === this.selectedIdx;
			const isChecked = checkedLabels.includes(opt.label);
			const num = `${i + 1}.`;
			const checkmark = isChecked ? ` ${t.fg("success", "✓")}` : "";
			const cursorMark = isCursor ? "> " : "  ";
			const accentHead = isCursor || isChecked;

			const wrappedLabel = wrapTextWithAnsi(opt.label, labelContentWidth);
			for (let li = 0; li < wrappedLabel.length; li++) {
				const segment = wrappedLabel[li];
				const isLast = li === wrappedLabel.length - 1;
				const suffix = isLast ? checkmark : "";

				if (li === 0) {
					// First line: render "  > N. label..." (or non-cursor variants).
					// Coloring whitespace is a no-op visually, so we can color the
					// whole `cursorMark + num + segment` chunk uniformly when active.
					const chunk = `${cursorMark}${num} ${segment}`;
					const coloredChunk = accentHead ? t.fg("accent", chunk) : chunk;
					lines.push(`  ${coloredChunk}${suffix}`);
				} else {
					// Continuation line: align under the label text.
					const coloredSegment = accentHead ? t.fg("accent", segment) : segment;
					lines.push(`${LABEL_PADDING}${coloredSegment}${suffix}`);
				}
			}

			if (opt.description) {
				const wrappedDesc = wrapTextWithAnsi(opt.description, labelContentWidth);
				for (const descLine of wrappedDesc) {
					lines.push(`${LABEL_PADDING}${t.fg("muted", descLine)}`);
				}
			}
		}

		// ── Freeform row ─────────────────────────────────────────
		const isOnFreeform = this.selectedIdx === freeformIdx;
		const otherNum = `${freeformIdx + 1}.`;
		const prefixWidth = 2; // "  " or "> "
		const numWidth = otherNum.length + 1; // e.g., "4. "
		const contentWidth = Math.max(10, width - prefixWidth - numWidth - 2); // -2 for cursor/checkmark space

		if (isOnFreeform) {
			const inputVal = this.freeformInput.getValue();
			if (inputVal === "") {
				// Block cursor over the "T" — invert the first char of the placeholder
				const placeholder = "Type something.";
				const cursorChar = `\x1b[7m${placeholder[0]}\x1b[27m`;
				const row = `  ${t.fg("accent", `> ${otherNum}`)} ${cursorChar}${t.fg("dim", placeholder.slice(1))}`;
				lines.push(truncateToWidth(row, width));
			} else {
				// Render the freeform value with the cursor positioned at the
				// Input's actual cursor offset, NOT pinned to the end of the
				// line. We splice an inverse-video cursor character into the
				// value at the cursor position, then wrap the result. Because
				// the cursor sequence (\x1b[7m + ch + \x1b[27m) has a visible
				// width of exactly one column, wrapTextWithAnsi places it
				// correctly within the wrapped lines.
				//
				// Previously the cursor block was always appended at the end of
				// the first wrapped line, so Left/Right/Home/End/word-jump key
				// presses moved the Input's internal cursor but never visibly
				// reflected the move — making the freeform field feel broken.
				const cursorPos = this.freeformInput.cursor;
				const before = inputVal.slice(0, cursorPos);
				const atCursorRaw = inputVal.slice(cursorPos, cursorPos + 1);
				const atCursor = atCursorRaw === "" ? " " : atCursorRaw;
				const after = atCursorRaw === "" ? "" : inputVal.slice(cursorPos + 1);
				const valueWithCursor = `${before}\x1b[7m${atCursor}\x1b[27m${after}`;

				const prefix = `  ${t.fg("accent", `> ${otherNum} `)}`;
				const wrappedLines = wrapTextWithAnsi(valueWithCursor, contentWidth);
				for (let i = 0; i < wrappedLines.length; i++) {
					if (i === 0) {
						lines.push(truncateToWidth(`${prefix}${wrappedLines[i]}`, width));
					} else {
						// Continuation lines get indented padding to align with content
						const padding = " ".repeat(prefixWidth + numWidth + 1);
						lines.push(truncateToWidth(`${padding}${wrappedLines[i]}`, width));
					}
				}
			}
		} else if (freeformValue && this.confirmedFreeform.has(q.question)) {
			// Confirmed — show with checkmark, wrapped across multiple lines
			const prefix = `    ${otherNum} `;
			const wrappedLines = wrapTextWithAnsi(freeformValue, contentWidth);
			for (let i = 0; i < wrappedLines.length; i++) {
				if (i === 0) {
					lines.push(truncateToWidth(`${prefix}${t.fg("accent", wrappedLines[i])} ${t.fg("success", "✓")}`, width));
				} else {
					const padding = " ".repeat(prefixWidth + numWidth + 1);
					lines.push(truncateToWidth(`${padding}${wrappedLines[i]}`, width));
				}
			}
		} else if (freeformValue) {
			// Typed but not yet confirmed — show without checkmark, wrapped
			const prefix = `    ${otherNum} `;
			const wrappedLines = wrapTextWithAnsi(freeformValue, contentWidth);
			for (let i = 0; i < wrappedLines.length; i++) {
				if (i === 0) {
					lines.push(truncateToWidth(`${prefix}${t.fg("dim", wrappedLines[i])}`, width));
				} else {
					const padding = " ".repeat(prefixWidth + numWidth + 1);
					lines.push(truncateToWidth(`${padding}${wrappedLines[i]}`, width));
				}
			}
		} else {
			// Not active, empty
			lines.push(truncateToWidth(`    ${otherNum} ${t.fg("dim", "Type something.")}`, width));
		}

		// ── Separator + Chat ─────────────────────────────────────
		lines.push("");
		lines.push(t.fg("dim", "─".repeat(Math.max(width - 2, 10))));
		lines.push("");

		const isChatCursor = this.selectedIdx === this.chatIdx;
		lines.push(isChatCursor
			? truncateToWidth(`  ${t.fg("accent", `> ${this.chatIdx + 1}. Chat about this`)}`, width)
			: truncateToWidth(`    ${this.chatIdx + 1}. ${t.fg("muted", "Chat about this")}`, width));

		lines.push("");
		lines.push(truncateToWidth(
			t.fg("dim", "Enter to select · Tab/↑↓ to navigate · Esc to cancel"),
			width,
		));

		return lines.map((l) => truncateToWidth(l, width));
	}
}
