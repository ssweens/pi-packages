import { describe, expect, it } from "vitest";
import { classifyCommandArgs } from "./command-args";

const tokens = (command: string, args: string[]) =>
  classifyCommandArgs(command, args).map((arg) => arg.token);

describe("classifyCommandArgs", () => {
  it("keeps unknown command arguments unchanged", () => {
    expect(tokens("cat", ["/etc/hosts", "./file"])).toEqual([
      "/etc/hosts",
      "./file",
    ]);
  });

  it("ignores awk inline program and keeps file operands", () => {
    expect(tokens("awk", ["/aaa/{print}", "./input"])).toEqual(["./input"]);
  });

  it("keeps awk -f program files", () => {
    expect(tokens("awk", ["-f", "./prog.awk", "./input"])).toEqual([
      "./prog.awk",
      "./input",
    ]);
  });

  it("ignores sed inline scripts and keeps file operands", () => {
    expect(tokens("sed", ["s#/old#/new#g", "./file"])).toEqual(["./file"]);
  });

  it("keeps sed -f script files", () => {
    expect(tokens("sed", ["-f", "./script.sed", "./file"])).toEqual([
      "./script.sed",
      "./file",
    ]);
  });

  it("ignores grep patterns and keeps file operands", () => {
    expect(tokens("grep", ["/api/v1", "./src"])).toEqual(["./src"]);
  });

  it("keeps grep pattern files", () => {
    expect(tokens("grep", ["-f", "./patterns", "./src"])).toEqual([
      "./patterns",
      "./src",
    ]);
  });

  it("keeps find roots and ignores expression patterns", () => {
    expect(tokens("find", ["./src", "-regex", ".*/test/.*"])).toEqual([
      "./src",
    ]);
  });

  it("ignores jq filters and keeps file operands", () => {
    expect(tokens("jq", ['.path | test("^/tmp/")', "./data.json"])).toEqual([
      "./data.json",
    ]);
  });

  it("keeps jq -f filter files", () => {
    expect(tokens("jq", ["-f", "./filter.jq", "./data.json"])).toEqual([
      "./filter.jq",
      "./data.json",
    ]);
  });

  it("ignores interpreter inline code", () => {
    expect(tokens("python3", ["-c", 'open("/etc/passwd")'])).toEqual([]);
  });

  it("keeps interpreter script operands", () => {
    expect(tokens("python3", ["./script.py", "./data.json"])).toEqual([
      "./script.py",
      "./data.json",
    ]);
  });

  it("ignores delimiter args", () => {
    expect(tokens("cut", ["-d", "/", "./file"])).toEqual(["./file"]);
    expect(tokens("sort", ["-t", "/", "./file"])).toEqual(["./file"]);
    expect(tokens("tr", ["/", ":"])).toEqual([]);
  });
});
