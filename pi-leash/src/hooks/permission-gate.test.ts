import { describe, expect, it } from "vitest";
import { isCwdScopedFileOperation } from "./permission-gate";

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
