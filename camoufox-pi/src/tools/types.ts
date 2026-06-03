import type { Static, TObject } from "@sinclair/typebox";

// Structural ToolDefinition compatible with @mariozechner/pi-coding-agent's
// ExtensionAPI.registerTool signature. Spec: §3.3. `execute` receives the
// PI turn AbortSignal; use AbortSignal.any to combine with internal timeouts.
export interface ToolDefinition<S extends TObject = TObject> {
	name: string;
	readOnly?: boolean;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: S;
	execute(
		toolCallId: string,
		input: Static<S>,
		signal: AbortSignal | undefined,
	): Promise<ToolExecuteResult>;
}

export interface ToolExecuteResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, ToolDetailValue>;
}

export type ToolDetailValue =
	| string
	| number
	| boolean
	| null
	| ToolDetailValue[]
	| { [key: string]: ToolDetailValue };
