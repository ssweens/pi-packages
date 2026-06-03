export interface CommandUI {
	notify(message: string, level?: string): void;
}

export interface CommandContext {
	cwd: string;
	ui: CommandUI;
}

export interface CommandDefinition {
	name: string;
	description?: string;
	handler(args: string, ctx: CommandContext): Promise<void>;
}
