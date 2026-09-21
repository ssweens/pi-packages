import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Role {
	name: string;
	description: string;
	systemPrompt: string;
	model?: string;
	thinking?: string;
	tools?: string[];
	context?: "fork" | "fresh";
	timeoutMs?: number;
	source: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lowest → highest priority; later dirs override same-named roles. */
export function roleDirs(cwd: string, projectTrusted: boolean): string[] {
	const home = homedir();
	const dirs = [
		join(HERE, "..", "roles"),
		join(home, ".pi", "agent", "agents"),
		join(home, ".agents", "agents"),
	];
	if (projectTrusted) dirs.push(join(cwd, ".pi", "agents"));
	return dirs;
}

function* mdFiles(dir: string): Generator<string> {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		let st;
		try {
			st = statSync(p);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			if (!name.startsWith("_") && !name.startsWith(".")) yield* mdFiles(p);
		} else if (name.endsWith(".md")) yield p;
	}
}

export function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
	if (!text.startsWith("---")) return { fm: {}, body: text };
	const end = text.indexOf("\n---", 3);
	if (end < 0) return { fm: {}, body: text };
	const fmText = text.slice(3, end);
	const body = text.slice(end + 4).replace(/^\r?\n/, "");
	const fm: Record<string, string> = {};
	let key: string | undefined;
	for (const line of fmText.split(/\r?\n/)) {
		const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (m) {
			key = m[1];
			fm[key] = m[2].trim();
		} else if (key && /^\s+\S/.test(line)) {
			fm[key] = `${fm[key]} ${line.trim()}`.trim();
		}
	}
	return { fm, body };
}

function toolList(v: string | undefined): string[] | undefined {
	if (!v) return undefined;
	const list = v
		.replace(/^\[|\]$/g, "")
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length ? list : undefined;
}

export function loadRoles(cwd: string, projectTrusted: boolean): Map<string, Role> {
	const roles = new Map<string, Role>();
	for (const dir of roleDirs(cwd, projectTrusted)) {
		for (const file of mdFiles(dir)) {
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				continue;
			}
			const { fm, body } = parseFrontmatter(text);
			if (!fm.name) continue;
			const ctx = (fm.context ?? fm.defaultContext) as string | undefined;
			roles.set(fm.name, {
				name: fm.name,
				description: fm.description ?? "",
				systemPrompt: body.trim(),
				model: fm.model && fm.model !== "inherit" ? fm.model : undefined,
				thinking: fm.thinking && fm.thinking !== "default" ? fm.thinking : undefined,
				tools: toolList(fm.tools),
				context: ctx === "fresh" || ctx === "fork" ? ctx : undefined,
				timeoutMs: fm.timeoutMs ? Number(fm.timeoutMs) || undefined : undefined,
				source: file.replace(homedir(), "~"),
			});
		}
	}
	return roles;
}
