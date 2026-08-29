import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../config";
import type { AutoModeController } from "./auto-mode";
import {
  clampDialogLines,
  DangerousReasonTrust,
  isCwdScopedFileOperation,
  setupPermissionGateHook,
  sliceScrollableLines,
} from "./permission-gate";

describe("DangerousReasonTrust", () => {
  const rm = { description: "recursive force delete" };
  const chmod = { description: "insecure recursive permissions" };
  const sudo = { description: "superuser command" };

  it("allows only the reason granted for five minutes", () => {
    const trust = new DangerousReasonTrust();
    trust.grantForWindow(rm.description, 1_000);

    expect(trust.allows([rm], 1_001)).toBe(true);
    expect(trust.allows([chmod], 1_001)).toBe(false);
    expect(trust.allows([sudo], 1_001)).toBe(false);
  });

  it("requires every reason in a multi-reason command to be trusted", () => {
    const trust = new DangerousReasonTrust();
    trust.grantForWindow(rm.description, 1_000);

    expect(trust.allows([rm, sudo], 1_001)).toBe(false);

    trust.grantForWindow(sudo.description, 1_001);
    expect(trust.allows([rm, sudo], 1_002)).toBe(true);
  });

  it("expires five-minute grants and keeps session grants until cleared", () => {
    const trust = new DangerousReasonTrust();
    trust.grantForWindow(rm.description, 1_000);
    expect(trust.allows([rm], 301_000)).toBe(false);

    trust.grantForSession(chmod.description);
    expect(trust.allows([chmod], Number.MAX_SAFE_INTEGER)).toBe(true);
    trust.clear();
    expect(trust.allows([chmod], Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("reason-scoped trust through the Pi tool-call hook", () => {
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
      explainTimeout: 5_000,
      autoMode: {
        enabled: false,
        model: null,
        timeout: 10_000,
        environment: [],
        allow: [],
        softDeny: [],
        hardDeny: [],
      },
      sudoMode: {
        enabled: false,
        timeout: 30_000,
        preserveEnv: false,
        cacheEnabled: false,
        cacheTtl: 300_000,
        maxRetries: 3,
      },
    },
  };

  function createHarness(
    selections: string[],
    autoMode?: AutoModeController,
    autoDenyPattern?: string,
    sudoModeEnabled = false,
  ) {
    const hookConfig = structuredClone(config);
    if (autoDenyPattern) {
      hookConfig.permissionGate.autoDenyPatterns = [
        { pattern: autoDenyPattern },
      ];
    }
    hookConfig.permissionGate.sudoMode.enabled = sudoModeEnabled;
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => Promise<unknown>
    >();
    const selectOptions: string[][] = [];
    const renderedDialogs: string[][] = [];
    const fakePi = {
      on(
        event: string,
        handler: (event: unknown, ctx: unknown) => Promise<unknown>,
      ) {
        handlers.set(event, handler);
      },
      events: { emit() {} },
      sendMessage() {},
    };
    const fakeContext = {
      hasUI: true,
      cwd: "/work/project",
      ui: {
        custom: async (
          factory: (
            tui: {
              terminal: { rows: number; columns: number };
              requestRender(): void;
            },
            theme: {
              fg(_color: string, text: string): string;
              bg(_color: string, text: string): string;
              bold(text: string): string;
            },
            kb: { matches(_data: string, _binding: string): boolean },
            done: (result: unknown) => void,
          ) => { render(width: number): string[] },
        ) => {
          let completed: unknown;
          const component = factory(
            {
              terminal: { rows: 40, columns: 120 },
              requestRender() {},
            },
            {
              fg: (_color, text) => text,
              bg: (_color, text) => text,
              bold: (text) => text,
            },
            { matches: () => false },
            (result) => {
              completed = result;
            },
          );
          renderedDialogs.push(component.render(120));
          return completed;
        },
        select: async (_title: string, options: string[]) => {
          selectOptions.push(options);
          return selections.shift();
        },
        input: async () => undefined,
        notify() {},
      },
    };

    setupPermissionGateHook(fakePi as never, hookConfig, autoMode);
    const toolCall = handlers.get("tool_call");
    if (!toolCall)
      throw new Error("Permission gate did not register tool_call");

    return {
      selectOptions,
      renderedDialogs,
      dispatch(command: string) {
        return toolCall(
          { toolName: "bash", toolCallId: command, input: { command } },
          fakeContext,
        );
      },
    };
  }

  it("records an auto-deny policy as a safety verdict", async () => {
    const verdicts: Array<{ decision: string; source: string }> = [];
    const harness = createHarness(
      [],
      {
        isEnabled: () => true,
        classify: async () => {
          throw new Error("auto-deny must run before classification");
        },
        recordVerdict: (verdict) => verdicts.push(verdict),
      },
      "rm -rf",
    );

    await expect(harness.dispatch("rm -rf ./scratch")).resolves.toEqual({
      block: true,
      reason:
        "Command matched auto-deny pattern and was blocked automatically.",
    });
    expect(verdicts).toEqual([
      {
        decision: "deny",
        reason: "Command matched an auto-deny policy.",
        source: "safety",
      },
    ]);
  });

  it("auto-approves sudo through to the password flow without generic approval", async () => {
    const verdicts: string[] = [];
    const harness = createHarness(
      [],
      {
        isEnabled: () => true,
        classify: async () => ({
          decision: "allow",
          reason: "Direct user requested the bounded privileged operation.",
          source: "classifier",
        }),
        recordVerdict: (verdict) => verdicts.push(verdict.decision),
      },
      undefined,
      true,
    );

    await expect(harness.dispatch("sudo true")).resolves.toEqual({
      block: true,
      reason: "User cancelled sudo password prompt",
    });
    expect(verdicts).toEqual(["allow"]);
    expect(harness.selectOptions).toHaveLength(0);
  });

  it("bypasses only the granted reason and keeps additional reasons gated", async () => {
    const harness = createHarness([
      "Allow recursive force delete for 5 min",
      "Deny",
      "Deny",
    ]);

    await expect(harness.dispatch("rm -rf ./one")).resolves.toBeUndefined();
    expect(harness.selectOptions).toHaveLength(1);
    expect(harness.selectOptions[0]).toContain(
      "Allow recursive force delete for 5 min",
    );
    expect(harness.renderedDialogs[0]?.join("\n")).toContain(
      "w: allow recursive force delete for 5 min",
    );

    await expect(harness.dispatch("rm -rf ./two")).resolves.toBeUndefined();
    expect(harness.selectOptions).toHaveLength(1);

    await expect(harness.dispatch("chmod -R 777 ./tmp")).resolves.toEqual({
      block: true,
      reason: "User denied dangerous command",
    });
    expect(harness.selectOptions).toHaveLength(2);
    expect(harness.selectOptions[1]).toContain(
      "Allow insecure recursive permissions for 5 min",
    );

    await expect(
      harness.dispatch("rm -rf ./three && sudo true"),
    ).resolves.toEqual({
      block: true,
      reason: "User denied dangerous command",
    });
    expect(harness.selectOptions).toHaveLength(3);
  });

  it("sends a critical recursive deletion to the classifier instead of a static fence", async () => {
    const seen: string[] = [];
    const verdicts: Array<{ decision: string; source: string }> = [];
    const harness = createHarness(["Deny"], {
      isEnabled: () => true,
      classify: async (action) => {
        seen.push(action.command);
        return {
          decision: "ask",
          reason: "Exact user intent is required for this deletion.",
          source: "classifier",
        };
      },
      recordVerdict: (verdict) => verdicts.push(verdict),
    });

    await expect(harness.dispatch("rm -rf /")).resolves.toEqual({
      block: true,
      reason: "User denied dangerous command",
    });
    expect(seen).toEqual(["rm -rf /"]);
    expect(verdicts).toEqual([
      {
        decision: "ask",
        reason: "Exact user intent is required for this deletion.",
        source: "classifier",
      },
    ]);
  });

  it("lets the auto classifier allow, deny, or retain the one-time manual prompt", async () => {
    const seen: string[] = [];
    const decisions: string[] = [];
    const allowHarness = createHarness([], {
      isEnabled: () => true,
      classify: async (action) => {
        seen.push(action.command);
        return {
          decision: "allow",
          reason: "Fresh scratch cleanup.",
          source: "classifier",
        };
      },
      recordVerdict: (verdict) => decisions.push(verdict.decision),
    });
    await expect(
      allowHarness.dispatch("rm -rf ./scratch"),
    ).resolves.toBeUndefined();
    expect(seen).toEqual(["rm -rf ./scratch"]);
    expect(allowHarness.selectOptions).toHaveLength(0);

    const denyHarness = createHarness([], {
      isEnabled: () => true,
      classify: async () => ({
        decision: "deny",
        reason: "Target is pre-existing.",
        source: "classifier",
      }),
      recordVerdict: (verdict) => decisions.push(verdict.decision),
    });
    await expect(denyHarness.dispatch("rm -rf ./old")).resolves.toEqual({
      block: true,
      reason: "Leash auto mode denied this action: Target is pre-existing.",
    });

    const askHarness = createHarness(["Deny"], {
      isEnabled: () => true,
      classify: async () => ({
        decision: "ask",
        reason: "Target provenance is incomplete.",
        source: "classifier",
      }),
      recordVerdict: (verdict) => decisions.push(verdict.decision),
    });
    await expect(askHarness.dispatch("rm -rf ./unknown")).resolves.toEqual({
      block: true,
      reason: "User denied dangerous command",
    });
    expect(askHarness.selectOptions[0]).not.toContain(
      "Allow recursive force delete for this session",
    );
    expect(decisions).toEqual(["allow", "deny", "ask"]);
  });
});

describe("clampDialogLines", () => {
  it("returns lines unchanged when already within height budget", () => {
    const lines = ["a", "b", "c"];
    expect(clampDialogLines(lines, 5, 2, 80, "… truncated …")).toEqual(lines);
  });

  it("preserves tail controls while truncating oversized dialogs", () => {
    const lines = [
      "title",
      "reason",
      "source",
      "long 1",
      "long 2",
      "long 3",
      "long 4",
      "long 5",
      "actions",
      "help",
      "border",
    ];

    expect(clampDialogLines(lines, 8, 3, 80, "… truncated …")).toEqual([
      "title",
      "reason",
      "source",
      "long 1",
      "… truncated …",
      "actions",
      "help",
      "border",
    ]);
  });

  it("handles very small budgets by keeping the truncation marker and tail", () => {
    const lines = ["1", "2", "3", "4", "5"];
    expect(clampDialogLines(lines, 3, 3, 80, "… truncated …")).toEqual([
      "… truncated …",
      "4",
      "5",
    ]);
  });
});

describe("sliceScrollableLines", () => {
  it("returns the visible window and max offset", () => {
    expect(sliceScrollableLines(["1", "2", "3", "4"], 2, 1)).toEqual({
      lines: ["2", "3"],
      offset: 1,
      maxOffset: 2,
    });
  });

  it("clamps offsets that are too small or too large", () => {
    expect(sliceScrollableLines(["1", "2", "3", "4"], 2, -5)).toEqual({
      lines: ["1", "2"],
      offset: 0,
      maxOffset: 2,
    });
    expect(sliceScrollableLines(["1", "2", "3", "4"], 2, 99)).toEqual({
      lines: ["3", "4"],
      offset: 2,
      maxOffset: 2,
    });
  });

  it("returns empty output for non-positive viewport heights", () => {
    expect(sliceScrollableLines(["1", "2"], 0, 0)).toEqual({
      lines: [],
      offset: 0,
      maxOffset: 0,
    });
  });
});

describe("isCwdScopedFileOperation", () => {
  const cwd = "/work/project";

  it("returns true when all extracted file targets are inside cwd", async () => {
    await expect(
      isCwdScopedFileOperation("rm -rf ./tmp/cache", cwd),
    ).resolves.toBe(true);
  });

  it("returns false when any extracted file target is outside cwd", async () => {
    await expect(
      isCwdScopedFileOperation("rm -rf /tmp/cache", cwd),
    ).resolves.toBe(false);
  });

  it("returns false when command has no extracted file targets", async () => {
    await expect(
      isCwdScopedFileOperation("sudo apt update", cwd),
    ).resolves.toBe(false);
  });

  it("returns false for mixed inside/outside targets", async () => {
    await expect(isCwdScopedFileOperation("cp ./a /tmp/b", cwd)).resolves.toBe(
      false,
    );
  });

  it("returns true when target is bare '.' (cwd itself)", async () => {
    await expect(isCwdScopedFileOperation("chmod -R 777 .", cwd)).resolves.toBe(
      true,
    );
  });

  it("returns true when bare '.' appears alongside other cwd paths", async () => {
    await expect(isCwdScopedFileOperation("rm -rf ./tmp .", cwd)).resolves.toBe(
      true,
    );
  });

  it("returns false when only target is bare '..' (parent of cwd)", async () => {
    await expect(
      isCwdScopedFileOperation("chmod -R 777 ..", cwd),
    ).resolves.toBe(false);
  });

  it("returns true for pipeline commands scoped to cwd", async () => {
    await expect(
      isCwdScopedFileOperation("chmod -R 777 . | cat", cwd),
    ).resolves.toBe(true);
  });

  it("returns true for shell heredoc scripts scoped to cwd", async () => {
    await expect(
      isCwdScopedFileOperation("bash <<'EOF'\nrm -rf ./tmp\nEOF", cwd),
    ).resolves.toBe(true);
  });

  it("returns false for shell heredoc scripts targeting outside cwd", async () => {
    await expect(
      isCwdScopedFileOperation("bash <<'EOF'\nrm -rf /tmp\nEOF", cwd),
    ).resolves.toBe(false);
  });
});
