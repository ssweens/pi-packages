import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent,
	createBashToolDefinition, createReadToolDefinition, createEditToolDefinition,
	createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
	getMarkdownTheme, type SettingsManager, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, type Component, type TUI, type TuiMouseEvent, Text } from "@earendil-works/pi-tui";

export interface ActiveTool {
	name: string;
	args: Record<string, unknown>;
	result?: Pick<ToolResultMessage, "content" | "details" | "isError">;
}
export interface ChildActivity {
	messages: Message[];
	streaming?: AssistantMessage;
	activeTools: Map<string, ActiveTool>;
	error?: string;
}

/** Pi owns formatting and disclosure; this adapter only matches calls to their results. */
export class ChildTranscript {
	private entries: { message: Message; component?: Component; streaming: boolean }[] = [];
	private tools = new Map<string, ToolExecutionComponent>();
	private partial = new Map<string, ActiveTool["result"]>();
	private container = new Container();
	private definitions: Map<string, ToolDefinition<any, any, any>>;
	private expanded = false;
	private hideThinking: boolean;
	private markdown;

	constructor(private tui: TUI, private cwd: string, private settings: SettingsManager) {
		this.hideThinking = settings.getHideThinkingBlock();
		this.markdown = { ...getMarkdownTheme(), codeBlockIndent: settings.getCodeBlockIndent() };
		this.definitions = new Map([
			createBashToolDefinition(cwd), createReadToolDefinition(cwd), createEditToolDefinition(cwd),
			createWriteToolDefinition(cwd), createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd),
		].map((tool) => [tool.name, tool]));
	}

	update(activity: ChildActivity) {
		this.container.clear();
		const messages = activity.streaming ? [...activity.messages, activity.streaming] : activity.messages;
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			const streaming = message === activity.streaming;
			let entry = this.entries[i];
			const changed = !entry || entry.message !== message || entry.streaming || streaming;
			if (changed) {
				if (message.role === "assistant") {
					const component = entry?.component instanceof AssistantMessageComponent ? entry.component
						: new AssistantMessageComponent(undefined, this.hideThinking, this.markdown, undefined, this.settings.getOutputPad());
					component.updateContent(message, streaming);
					entry = { message, streaming, component };
				} else if (message.role === "user") {
					const text = typeof message.content === "string" ? message.content : message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
					entry = { message, streaming, component: new UserMessageComponent(text, this.markdown, this.settings.getOutputPad()) };
				} else entry = { message, streaming };
				this.entries[i] = entry;
			}
			if (entry.component) this.container.addChild(entry.component);
			if (message.role === "assistant") for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				let tool = this.tools.get(block.id);
				if (!tool) {
					tool = new ToolExecutionComponent(block.name, block.id, block.arguments, {
						showImages: this.settings.getShowImages(), imageWidthCells: this.settings.getImageWidthCells(),
					}, this.definitions.get(block.name), this.tui, this.cwd);
					tool.setExpanded(this.expanded);
					this.tools.set(block.id, tool);
				} else if (changed) tool.updateArgs(block.arguments);
				if (changed && !streaming) tool.setArgsComplete();
				if (changed && (message.stopReason === "error" || message.stopReason === "aborted")) {
					tool.updateResult({ content: [{ type: "text", text: message.errorMessage ?? "Operation aborted" }], isError: true });
				}
				this.container.addChild(tool);
			} else if (message.role === "toolResult") {
				if (changed) this.tools.get(message.toolCallId)?.updateResult(message);
				this.partial.delete(message.toolCallId);
			}
		}
		this.entries.length = messages.length;
		for (const [id, active] of activity.activeTools) {
			const tool = this.tools.get(id);
			if (!tool) continue;
			tool.markExecutionStarted();
			if (active.result) { tool.updateResult(active.result, true); this.partial.set(id, active.result); }
		}
		if (activity.error) this.container.addChild(new Text(activity.error, this.settings.getOutputPad(), 0));
	}

	toggleTools() {
		this.expanded = !this.expanded;
		for (const tool of this.tools.values()) tool.setExpanded(this.expanded);
	}
	toggleThinking() {
		this.hideThinking = !this.hideThinking;
		for (const entry of this.entries) if (entry.component instanceof AssistantMessageComponent) entry.component.setHideThinkingBlock(this.hideThinking);
	}
	render(width: number) { return this.container.render(width); }
	handleMouse(event: TuiMouseEvent) { return this.container.handleMouse(event); }
	invalidate() { this.container.invalidate(); }
	dispose() {
		// Pi's shell renderer owns an elapsed-time interval but exposes no dispose method.
		// Finalize only the discarded presentation; never cancel or settle actual child work.
		for (const [id, result] of this.partial) if (result) this.tools.get(id)?.updateResult(result, false);
		this.partial.clear();
	}
}
