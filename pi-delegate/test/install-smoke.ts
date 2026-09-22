import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = mkdtempSync(join(tmpdir(), "pi-delegate-install-"));
const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle/cli.js");
const env = { ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" };
try {
	const [pack] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", root], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 30000 }));
	const paths = new Set(pack.files.map((file: { path: string }) => file.path));
	for (const path of ["src/index.ts", "src/inspector.ts", "src/transcript.ts", "skills/delegation/SKILL.md", "roles/scout.md", "roles/worker.md", "roles/reviewer.md"]) assert(paths.has(path), `Missing packaged ${path}`);
	const cwd = join(root, "project"); mkdirSync(cwd);
	// Optional source exercises another real pi install route, e.g. npm:… or git:….
	// Without one, use the current artifact—not a potentially stale published release.
	execFileSync("tar", ["-xzf", join(root, pack.filename), "-C", root]);
	const source = process.argv[2] ?? join(root, "package");
	// Pi links local directories; unlike npm/git sources, it does not install their dependencies.
	if (!process.argv[2]) execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: source, encoding: "utf8", timeout: 120000 });
	execFileSync(process.execPath, [cli, "install", source], { cwd, env, encoding: "utf8", timeout: 120000 });
	process.env.HOME = root; process.env.PI_CODING_AGENT_DIR = env.PI_CODING_AGENT_DIR; process.env.PI_OFFLINE = "1";
	const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
	const loader = new DefaultResourceLoader({ cwd, agentDir: env.PI_CODING_AGENT_DIR, noContextFiles: true });
	await loader.reload();
	const result = loader.getExtensions();
	assert.deepEqual(result.errors, []);
	const tools = result.extensions.flatMap((extension) => [...extension.tools.keys()]);
	assert.equal(tools.filter((name) => name === "delegate").length, 1);
	assert.equal(tools.filter((name) => name === "delegate_ctl").length, 1);
	const skill = loader.getSkills().skills.find((skill) => skill.name === "delegation"); assert(skill);
	assert.match(readFileSync(skill.filePath, "utf8"), /Model per role/);
	const definition = result.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "delegate");
	assert(definition); assert.match(definition.definition.description, /delegation skill/);
	const installed = result.extensions.find((extension) => extension.tools.has("delegate")); assert(installed);
	const { loadRoles } = await import(pathToFileURL(join(dirname(installed.path), "roles.ts")).href);
	const roles = loadRoles(cwd, false);
	assert.deepEqual([...roles.keys()].sort(), ["reviewer", "scout", "worker"]);
	console.log(`PASS packaged resources and isolated pi install: ${source}`);
} finally { rmSync(root, { recursive: true, force: true }); }
