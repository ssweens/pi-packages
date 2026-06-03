import type { CamoufoxService } from "../services/camoufox-service.js";
import type { CommandDefinition } from "./types.js";

export type { CommandContext, CommandDefinition, CommandUI } from "./types.js";

export function createAllCommands(_service: CamoufoxService): CommandDefinition[] {
	return [];
}
