import "./formats.js";

import type { CamoufoxService } from "../services/camoufox-service.js";
import { createFetchSourcesTool } from "./fetch-sources.js";
import { createFetchUrlTool } from "./fetch-url.js";
import { createSearchWebTool } from "./search-web.js";
import type { ToolDefinition } from "./types.js";

export type { ToolDefinition, ToolDetailValue, ToolExecuteResult } from "./types.js";

export function createAllTools(service: CamoufoxService): ToolDefinition[] {
	const client = service.getClient();
	return [createFetchUrlTool(client), createSearchWebTool(client), createFetchSourcesTool(client)];
}
