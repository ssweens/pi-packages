// tests/edge/router.test.ts
//
// AP-3 + dispatch + TC-2 alias coverage for routeClaudePlugin /
// routeMarketplace. The router is a pure function of
// `(args, handlers, ctx)`, so these tests instantiate handlers as spies,
// build a notify-recording `ctx`, and assert directly on the recorded
// state.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MARKETPLACE_USAGE,
  routeClaudePlugin,
  TOP_LEVEL_USAGE,
  type SubcommandHandlers,
} from "../../extensions/pi-plugins/edge/router.ts";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface NotifyRecord {
  message: string;
  severity?: string;
}

function makeCtx(options: { menuSelections?: (string | undefined)[]; inputValues?: string[] } = {}): {
  ctx: ExtensionCommandContext;
  notifications: NotifyRecord[];
  customCalls: number;
  inputCalls: string[];
} {
  const notifications: NotifyRecord[] = [];
  const menuSelections = [...(options.menuSelections ?? [])];
  const inputValues = [...(options.inputValues ?? [])];
  const inputCalls: string[] = [];
  let customCalls = 0;
  const ctx = {
    ui: {
      notify: (m: string, s?: string): void => {
        notifications.push(s === undefined ? { message: m } : { message: m, severity: s });
      },
      custom: (): Promise<string | undefined> => {
        customCalls++;
        return Promise.resolve(menuSelections.shift());
      },
      input: (title: string): Promise<string | undefined> => {
        inputCalls.push(title);
        return Promise.resolve(inputValues.shift());
      },
    },
  } as unknown as ExtensionCommandContext;
  return {
    ctx,
    notifications,
    get customCalls() {
      return customCalls;
    },
    inputCalls,
  };
}

interface HandlerCall {
  name: keyof SubcommandHandlers;
  args: string;
}

function makeHandlers(): { handlers: SubcommandHandlers; calls: HandlerCall[] } {
  const calls: HandlerCall[] = [];
  const mk =
    (name: keyof SubcommandHandlers) =>
    (args: string): Promise<void> => {
      calls.push({ name, args });
      return Promise.resolve();
    };

  const handlers: SubcommandHandlers = {
    bootstrap: mk("bootstrap"),
    install: mk("install"),
    uninstall: mk("uninstall"),
    update: mk("update"),
    reinstall: mk("reinstall"),
    list: mk("list"),
    import: mk("import"),
    marketplaceAdd: mk("marketplaceAdd"),
    marketplaceRemove: mk("marketplaceRemove"),
    marketplaceList: mk("marketplaceList"),
    marketplaceUpdate: mk("marketplaceUpdate"),
    marketplaceAutoupdate: mk("marketplaceAutoupdate"),
    marketplaceNoautoupdate: mk("marketplaceNoautoupdate"),
  };
  return { handlers, calls };
}

test("AP-3 :: empty input opens the top-level TUI menu instead of emitting usage", async () => {
  const testCtx = makeCtx({ menuSelections: [undefined] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("", handlers, testCtx.ctx);
  assert.deepEqual(calls, []);
  assert.deepEqual(testCtx.notifications, []);
  assert.equal(testCtx.customCalls, 1);
  assert.ok(
    TOP_LEVEL_USAGE.includes(
      "reinstall [<plugin>@<marketplace> | @<marketplace>] [--scope user|project] [--force]",
    ),
  );
});

test("AP-3 :: unknown subcommand emits Unknown subcommand: + TOP_LEVEL_USAGE at error severity", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("unknownverb foo", handlers, ctx);
  assert.deepEqual(calls, []);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.severity, "error");
  assert.ok(notifications[0]?.message.startsWith('Unknown subcommand: "unknownverb".'));
  assert.ok(notifications[0]?.message.includes(TOP_LEVEL_USAGE));
});

test("AP-3 :: marketplace with empty rest opens marketplace TUI menu", async () => {
  const testCtx = makeCtx({ menuSelections: [undefined] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace", handlers, testCtx.ctx);
  assert.deepEqual(calls, []);
  assert.deepEqual(testCtx.notifications, []);
  assert.equal(testCtx.customCalls, 1);
  assert.ok(MARKETPLACE_USAGE.includes("marketplace <add|remove|rm|list|ls|update|autoupdate|noautoupdate>"));
});

test("AP-3 :: marketplace with unknown verb emits Unknown subcommand: + MARKETPLACE_USAGE", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace bogus arg", handlers, ctx);
  assert.deepEqual(calls, []);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.severity, "error");
  assert.ok(notifications[0]?.message.startsWith('Unknown marketplace subcommand: "bogus".'));
  assert.ok(notifications[0]?.message.includes(MARKETPLACE_USAGE));
});

test("menu path :: selecting marketplace then list dispatches marketplaceList without usage", async () => {
  const testCtx = makeCtx({ menuSelections: ["marketplace", "list"] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("", handlers, testCtx.ctx);
  assert.deepEqual(calls, [{ name: "marketplaceList", args: "" }]);
  assert.deepEqual(testCtx.notifications, []);
  assert.equal(testCtx.customCalls, 2);
});

test("menu path :: marketplace add prompts for source before dispatch", async () => {
  const testCtx = makeCtx({ menuSelections: ["add"], inputValues: ["gh:owner/repo"] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace", handlers, testCtx.ctx);
  assert.deepEqual(calls, [{ name: "marketplaceAdd", args: "gh:owner/repo" }]);
  assert.deepEqual(testCtx.notifications, []);
  assert.deepEqual(testCtx.inputCalls, ["Add marketplace"]);
});

test("menu path :: top-level install prompts for plugin ref before dispatch", async () => {
  const testCtx = makeCtx({ menuSelections: ["install"], inputValues: ["foo@bar"] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("", handlers, testCtx.ctx);
  assert.deepEqual(calls, [{ name: "install", args: "foo@bar" }]);
  assert.deepEqual(testCtx.notifications, []);
  assert.deepEqual(testCtx.inputCalls, ["Install plugin"]);
});

test("menu path :: top-level uninstall prompts for plugin ref before dispatch", async () => {
  const testCtx = makeCtx({ menuSelections: ["uninstall"], inputValues: ["foo@bar"] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("", handlers, testCtx.ctx);
  assert.deepEqual(calls, [{ name: "uninstall", args: "foo@bar" }]);
  assert.deepEqual(testCtx.notifications, []);
  assert.deepEqual(testCtx.inputCalls, ["Uninstall plugin"]);
});

for (const [selection, expected] of [
  ["bootstrap", "bootstrap"],
  ["update", "update"],
  ["reinstall", "reinstall"],
  ["list", "list"],
  ["import", "import"],
] as const) {
  test(`menu path :: top-level ${selection} dispatches without usage`, async () => {
    const testCtx = makeCtx({ menuSelections: [selection] });
    const { handlers, calls } = makeHandlers();
    await routeClaudePlugin("", handlers, testCtx.ctx);
    assert.deepEqual(calls, [{ name: expected, args: "" }]);
    assert.deepEqual(testCtx.notifications, []);
    assert.deepEqual(testCtx.inputCalls, []);
  });
}

test("menu path :: marketplace remove prompts for name before dispatch", async () => {
  const testCtx = makeCtx({ menuSelections: ["remove"], inputValues: ["official"] });
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace", handlers, testCtx.ctx);
  assert.deepEqual(calls, [{ name: "marketplaceRemove", args: "official" }]);
  assert.deepEqual(testCtx.notifications, []);
  assert.deepEqual(testCtx.inputCalls, ["Remove marketplace"]);
});

for (const [selection, expected] of [
  ["list", "marketplaceList"],
  ["update", "marketplaceUpdate"],
  ["autoupdate", "marketplaceAutoupdate"],
  ["noautoupdate", "marketplaceNoautoupdate"],
] as const) {
  test(`menu path :: marketplace ${selection} dispatches without usage`, async () => {
    const testCtx = makeCtx({ menuSelections: [selection] });
    const { handlers, calls } = makeHandlers();
    await routeClaudePlugin("marketplace", handlers, testCtx.ctx);
    assert.deepEqual(calls, [{ name: expected, args: "" }]);
    assert.deepEqual(testCtx.notifications, []);
    assert.deepEqual(testCtx.inputCalls, []);
  });
}

test("routeClaudePlugin :: dispatches bootstrap to handlers.bootstrap", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("bootstrap", handlers, ctx);
  assert.deepEqual(calls, [{ name: "bootstrap", args: "" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches install to handlers.install", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("install foo@bar --scope user", handlers, ctx);
  assert.deepEqual(calls, [{ name: "install", args: "foo@bar --scope user" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches uninstall to handlers.uninstall", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("uninstall foo@bar", handlers, ctx);
  assert.deepEqual(calls, [{ name: "uninstall", args: "foo@bar" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches update to handlers.update", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("update foo@bar", handlers, ctx);
  assert.deepEqual(calls, [{ name: "update", args: "foo@bar" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches reinstall to handlers.reinstall", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("reinstall foo@bar --force", handlers, ctx);
  assert.deepEqual(calls, [{ name: "reinstall", args: "foo@bar --force" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches list to handlers.list", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("list bar", handlers, ctx);
  assert.deepEqual(calls, [{ name: "list", args: "bar" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches import to handlers.import", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("import --scope user", handlers, ctx);
  assert.deepEqual(calls, [{ name: "import", args: "--scope user" }]);
  assert.deepEqual(notifications, []);
});

test("routeClaudePlugin :: dispatches ls alias to handlers.list", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("ls bar --scope project", handlers, ctx);
  assert.deepEqual(calls, [{ name: "list", args: "bar --scope project" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches add to handlers.marketplaceAdd", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace add gh:owner/repo", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceAdd", args: "gh:owner/repo" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches remove to handlers.marketplaceRemove", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace remove myname", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceRemove", args: "myname" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches rm alias to handlers.marketplaceRemove (TC-2 surface, alias accepted)", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace rm myname", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceRemove", args: "myname" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches list to handlers.marketplaceList", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace list", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceList", args: "" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches ls alias to handlers.marketplaceList", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace ls", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceList", args: "" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches update to handlers.marketplaceUpdate", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace update myname", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceUpdate", args: "myname" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches autoupdate to handlers.marketplaceAutoupdate", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace autoupdate", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceAutoupdate", args: "" }]);
  assert.deepEqual(notifications, []);
});

test("routeMarketplace :: dispatches noautoupdate to handlers.marketplaceNoautoupdate", async () => {
  const { ctx, notifications } = makeCtx();
  const { handlers, calls } = makeHandlers();
  await routeClaudePlugin("marketplace noautoupdate myname --scope project", handlers, ctx);
  assert.deepEqual(calls, [{ name: "marketplaceNoautoupdate", args: "myname --scope project" }]);
  assert.deepEqual(notifications, []);
});
