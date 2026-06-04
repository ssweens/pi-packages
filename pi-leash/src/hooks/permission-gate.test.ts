import { describe, expect, it } from "vitest";
import {
  clampDialogLines,
  isCwdScopedFileOperation,
  sliceScrollableLines,
} from "./permission-gate";

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
