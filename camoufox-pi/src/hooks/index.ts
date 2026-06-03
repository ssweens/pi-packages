import type { CamoufoxService } from "../services/camoufox-service.js";

export interface HookDefinition {
	event: string;
	handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
}

export function createAllHooks(_service: CamoufoxService): HookDefinition[] {
	return [];
}
