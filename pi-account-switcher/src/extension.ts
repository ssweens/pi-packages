import { createJiti } from "@mariozechner/jiti";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default async function accountSwitcherBootstrap(pi: ExtensionAPI) {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const jiti = createJiti(import.meta.url, {
    alias: {
      "@": srcDir,
    },
  });

  const extension = await jiti.import<(pi: ExtensionAPI) => void | Promise<void>>("./index", {
    default: true,
  });

  await extension(pi);
}
