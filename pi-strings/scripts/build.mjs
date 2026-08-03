import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("../vendor/pi-acp/src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/pi-acp.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  external: ["@agentclientprotocol/sdk", "proper-lockfile", "write-file-atomic", "zod"],
});
await chmod(new URL("../dist/pi-acp.js", import.meta.url), 0o755);
