// TypeBox format registrations. Imported by tool wrappers to ensure URL
// validation actually fires on `Type.String({ format: "uri" })`.
import { FormatRegistry } from "@sinclair/typebox";

// Allow-list: only http and https. URL.canParse accepts file://, javascript:,
// data:, chrome://, etc. — all unsafe for an LLM-callable fetcher.
FormatRegistry.Set("uri", (value) => {
	if (!URL.canParse(value)) return false;
	const parsed = new URL(value);
	return parsed.protocol === "http:" || parsed.protocol === "https:";
});
