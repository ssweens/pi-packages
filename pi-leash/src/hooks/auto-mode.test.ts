import { initTheme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type * as ConfigModule from "../config";
import type { ResolvedConfig } from "../config";
import type * as AutoModeClassifierModule from "../lib/auto-mode-classifier";
import { setupAutoMode } from "./auto-mode";

const { updateAutoModeConfigMock, classifyAutoModeActionMock } = vi.hoisted(
  () => ({
    updateAutoModeConfigMock: vi.fn(),
    classifyAutoModeActionMock: vi.fn(),
  }),
);

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigModule>()),
  updateAutoModeConfig: updateAutoModeConfigMock,
}));

vi.mock("../lib/auto-mode-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof AutoModeClassifierModule>()),
  classifyAutoModeAction: classifyAutoModeActionMock,
}));

initTheme();

const config: ResolvedConfig = {
  enabled: true,
  features: { policies: false, pathAccess: false, permissionGate: true },
  policies: { rules: [] },
  pathAccess: { mode: "ask", allowedPaths: [] },
  permissionGate: {
    patterns: [],
    useBuiltinMatchers: true,
    requireConfirmation: true,
    allowedPatterns: [],
    autoDenyPatterns: [],
    explainCommands: false,
    explainModel: null,
    explainTimeout: 5000,
    autoMode: {
      enabled: false,
      model: null,
      timeout: 10000,
      environment: [],
      allow: [],
      softDeny: [],
      hardDeny: [],
    },
    sudoMode: {
      enabled: false,
      timeout: 30000,
      preserveEnv: false,
      cacheEnabled: false,
      cacheTtl: 300000,
      maxRetries: 3,
    },
  },
};

describe("Leash auto-mode controls", () => {
  it("toggles through the slash command and keyboard shortcut, persists session state, and updates status", async () => {
    const eventHandlers = new Map<
      string,
      (event: unknown, ctx: unknown) => Promise<void>
    >();
    const commands = new Map<
      string,
      { handler(args: string, ctx: unknown): Promise<void> }
    >();
    const shortcuts = new Map<
      string,
      { handler(ctx: unknown): Promise<void> }
    >();
    const statuses = new Map<string, string | undefined>();
    const notices: string[] = [];
    const entries: unknown[] = [];

    const pi = {
      on(
        event: string,
        handler: (event: unknown, ctx: unknown) => Promise<void>,
      ) {
        eventHandlers.set(event, handler);
      },
      registerCommand(
        name: string,
        definition: { handler(args: string, ctx: unknown): Promise<void> },
      ) {
        commands.set(name, definition);
      },
      registerShortcut(
        key: string,
        definition: { handler(ctx: unknown): Promise<void> },
      ) {
        shortcuts.set(key, definition);
      },
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    };
    const ctx = {
      hasUI: true,
      model: { provider: "test", id: "classifier" },
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        setStatus(key: string, value: string | undefined) {
          statuses.set(key, value);
        },
        notify(message: string) {
          notices.push(message);
        },
      },
      sessionManager: { getBranch: () => [] },
    };

    const controller = setupAutoMode(pi as never, config);
    await eventHandlers.get("session_start")?.({}, ctx as never);

    await commands.get("leash")?.handler("auto", ctx as never);
    controller.recordVerdict(
      {
        decision: "allow",
        reason: "Fresh scratch cleanup.",
        source: "classifier",
      },
      ctx as never,
    );
    expect(controller.isEnabled()).toBe(true);
    expect(entries).toMatchObject([
      { enabled: true },
      {
        decision: "allow",
        reason: "Fresh scratch cleanup.",
        source: "classifier",
      },
    ]);
    expect(statuses.get("leash-auto")).toBe("⏵⏵ leash auto");
    expect(statuses.get("leash-auto-verdict")).toContain("leash allow");

    await commands.get("leash")?.handler("status", ctx as never);
    expect(notices.at(-1)).toContain("allow 1 · ask 0 · deny 0");
    expect(notices.at(-1)).toContain("Last: allow [classifier]");

    await shortcuts.get("ctrl+alt+l")?.handler(ctx as never);
    expect(controller.isEnabled()).toBe(false);
    expect(entries).toHaveLength(3);
    expect(entries.at(-1)).toEqual({ enabled: false });
    expect(statuses.get("leash-auto")).toBeUndefined();
    expect(notices).toContain(
      "Leash auto mode enabled. Dangerous Bash actions are classifier-gated.",
    );
  });

  it("rotates only the auto marker while the classifier is pending", async () => {
    vi.useFakeTimers();
    classifyAutoModeActionMock.mockReset();
    try {
      const eventHandlers = new Map<
        string,
        (event: unknown, ctx: unknown) => Promise<void>
      >();
      const commands = new Map<
        string,
        { handler(args: string, ctx: unknown): Promise<void> }
      >();
      const statuses = new Map<string, string | undefined>();
      let resolveClassifier!: (verdict: {
        decision: "allow";
        reason: string;
        source: "classifier";
      }) => void;
      classifyAutoModeActionMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveClassifier = resolve;
        }),
      );

      const pi = {
        on(
          event: string,
          handler: (event: unknown, ctx: unknown) => Promise<void>,
        ) {
          eventHandlers.set(event, handler);
        },
        registerCommand(
          name: string,
          definition: { handler(args: string, ctx: unknown): Promise<void> },
        ) {
          commands.set(name, definition);
        },
        registerShortcut() {},
        appendEntry() {},
      };
      const ctx = {
        hasUI: true,
        model: { provider: "test", id: "classifier" },
        ui: {
          theme: {
            fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
          },
          setStatus(key: string, value: string | undefined) {
            statuses.set(key, value);
          },
          notify() {},
        },
        sessionManager: { getBranch: () => [] },
      };

      const controller = setupAutoMode(pi as never, structuredClone(config));
      await eventHandlers.get("session_start")?.({}, ctx as never);
      await commands.get("leash")?.handler("auto", ctx as never);

      const pending = controller.classify(
        {
          toolName: "bash",
          input: { command: "rm -rf /tmp/leash-test" },
          command: "rm -rf /tmp/leash-test",
          description: "recursive force delete",
          pattern: "rm -rf",
        },
        ctx as never,
      );

      expect(statuses.get("leash-auto")).toBe(
        "<accent>⏵</accent><warning>⏵</warning> <accent>leash auto</accent>",
      );
      await vi.advanceTimersByTimeAsync(180);
      expect(statuses.get("leash-auto")).toBe(
        "<warning>⏵</warning><success>⏵</success> <accent>leash auto</accent>",
      );

      resolveClassifier({
        decision: "allow",
        reason: "Bounded test cleanup.",
        source: "classifier",
      });
      await pending;
      expect(statuses.get("leash-auto")).toBe("<accent>⏵⏵ leash auto</accent>");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores auto verdict counts and the last decision from the session", async () => {
    const eventHandlers = new Map<
      string,
      (event: unknown, ctx: unknown) => Promise<void>
    >();
    const commands = new Map<
      string,
      { handler(args: string, ctx: unknown): Promise<void> }
    >();
    const notices: string[] = [];
    const pi = {
      on(
        event: string,
        handler: (event: unknown, ctx: unknown) => Promise<void>,
      ) {
        eventHandlers.set(event, handler);
      },
      registerCommand(
        name: string,
        definition: { handler(args: string, ctx: unknown): Promise<void> },
      ) {
        commands.set(name, definition);
      },
      registerShortcut() {},
      appendEntry() {},
    };
    const ctx = {
      model: { provider: "test", id: "classifier" },
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        notify(message: string) {
          notices.push(message);
        },
        setStatus() {},
      },
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "leash-auto-mode",
            data: { enabled: true },
          },
          {
            type: "custom",
            customType: "leash-auto-verdict",
            data: {
              decision: "ask",
              reason: "Target provenance is incomplete.",
              source: "classifier",
              timestamp: 1,
            },
          },
          {
            type: "custom",
            customType: "leash-auto-verdict",
            data: {
              decision: "deny",
              reason: "Target is outside the approved boundary.",
              source: "safety",
              timestamp: 2,
            },
          },
        ],
      },
    };

    const controller = setupAutoMode(pi as never, structuredClone(config));
    await eventHandlers.get("session_start")?.({}, ctx as never);
    await commands.get("leash")?.handler("status", ctx as never);

    expect(controller.isEnabled()).toBe(true);
    expect(notices[0]).toContain("allow 0 · ask 1 · deny 1");
    expect(notices[0]).toContain("Last: deny [safety]");
  });

  it("applies the settings auto toggle to this session and uses Pi's model selector", async () => {
    updateAutoModeConfigMock.mockReset();
    const localConfig = structuredClone(config);
    const commands = new Map<
      string,
      { handler(args: string, ctx: unknown): Promise<void> }
    >();
    const entries: unknown[] = [];
    const statuses = new Map<string, string | undefined>();
    let customCall = 0;

    const pi = {
      on() {},
      registerCommand(
        name: string,
        definition: { handler(args: string, ctx: unknown): Promise<void> },
      ) {
        commands.set(name, definition);
      },
      registerShortcut() {},
      appendEntry(_type: string, data: unknown) {
        entries.push(data);
      },
    };
    const ctx = {
      hasUI: true,
      model: { provider: "test", id: "active" },
      modelRegistry: {
        refresh() {},
        getError: () => undefined,
        getAvailable: () => [
          { provider: "test", id: "active", name: "Active" },
        ],
        find: (provider: string, id: string) =>
          provider === "test" && id === "active"
            ? { provider: "test", id: "active", name: "Active" }
            : undefined,
      },
      ui: {
        theme: {
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        },
        setStatus(key: string, value: string | undefined) {
          statuses.set(key, value);
        },
        notify() {},
        custom<T>(
          factory: (
            tui: { requestRender(): void },
            theme: {
              fg(_color: string, text: string): string;
              bold(text: string): string;
            },
            keybindings: unknown,
            done: (value: T) => void,
          ) => { handleInput(data: string): void },
        ): Promise<T> {
          return new Promise((resolve) => {
            const component = factory(
              { requestRender() {} },
              this.theme,
              undefined,
              resolve,
            );
            if (customCall === 0) component.handleInput("\r");
            if (customCall === 1) {
              component.handleInput("\x1b[B");
              component.handleInput("\r");
            }
            if (customCall === 2) {
              queueMicrotask(() => component.handleInput("\r"));
            }
            if (customCall === 3) component.handleInput("\x1b");
            customCall += 1;
          });
        },
      },
      sessionManager: { getBranch: () => [] },
    };

    const controller = setupAutoMode(pi as never, localConfig);
    await commands.get("leash")?.handler("settings", ctx as never);

    expect(controller.isEnabled()).toBe(true);
    expect(localConfig.permissionGate.autoMode.enabled).toBe(true);
    expect(entries).toEqual([{ enabled: true }]);
    expect(updateAutoModeConfigMock).toHaveBeenNthCalledWith(1, {
      enabled: true,
    });
    expect(updateAutoModeConfigMock).toHaveBeenNthCalledWith(2, {
      model: "test/active",
    });
    expect(statuses.get("leash-auto")).toContain("leash auto");
  });
});
