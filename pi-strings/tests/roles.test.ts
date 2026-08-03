import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceContract, parseAcceptanceReport, roleContract, WORKER_CONTRACT } from "../extensions/pi-strings/domain/roles.ts";

test("the generic worker safety contract is non-empty and forbids orchestration", () => {
  assert.ok(WORKER_CONTRACT.length > 0);
  assert.match(WORKER_CONTRACT, /not the orchestrator/);
});

test("roleContract emits a fixed output shape per kind and nothing for free", () => {
  assert.match(roleContract("oracle"), /\[oracle contract\]/);
  assert.match(roleContract("oracle"), /## TL;DR/);
  assert.match(roleContract("finder"), /\[finder contract\]/);
  assert.match(roleContract("finder"), /## Locations/);
  assert.match(roleContract("worker"), /\[worker contract\]/);
  assert.match(roleContract("worker"), /## Verification/);
  assert.equal(roleContract("free"), "");
});

test("acceptanceContract appends a fenced report block for non-free kinds only", () => {
  assert.match(acceptanceContract("worker"), /```acceptance-report/);
  assert.match(acceptanceContract("oracle"), /```acceptance-report/);
  assert.match(acceptanceContract("finder"), /```acceptance-report/);
  assert.equal(acceptanceContract("free"), "");
});

test("parseAcceptanceReport extracts a valid fenced JSON block", () => {
  const output = "## Summary\ndid the thing\n```acceptance-report\n{ \"changedFiles\": [\"src/a.ts\"], \"testsAddedOrUpdated\": [], \"commandsRun\": [], \"residualRisks\": [\"none\"] }\n```";
  const report = parseAcceptanceReport(output);
  assert.equal(report.parsed, true);
  assert.deepEqual(report.report, { changedFiles: ["src/a.ts"], testsAddedOrUpdated: [], commandsRun: [], residualRisks: ["none"] });
});

test("parseAcceptanceReport returns parsed=false when the block is missing or malformed", () => {
  assert.equal(parseAcceptanceReport("no block here").parsed, false);
  assert.equal(parseAcceptanceReport("```acceptance-report\n{ not json }\n```").parsed, false);
});
