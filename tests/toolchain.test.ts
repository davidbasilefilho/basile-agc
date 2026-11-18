import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function lintFixture(source: string, typeAware = false) {
  const directory = mkdtempSync(
    typeAware ? resolve("tests/.tooling-fixtures-") : join(tmpdir(), "basileagc-lint-"),
  );
  try {
    const path = join(directory, "fixture.ts");
    writeFileSync(path, source);
    const result = Bun.spawnSync([
      process.execPath,
      "--bun",
      "oxlint",
      "--config",
      resolve(".oxlintrc.json"),
      "--no-ignore",
      ...(typeAware ? ["--type-aware"] : []),
      path,
    ]);
    return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("JSDoc is required for exported declarations", () => {
  for (const source of [
    "export function sample() { return 1; }",
    "export const sample = () => 1;",
    "export interface Sample { value: number }",
    "export type Sample = number;",
    "export class Sample {}",
    "export const sample = 1;",
    "function sample() { return 1; } export { sample };",
  ]) {
    const result = lintFixture(source);
    expect(result.output).toContain("Missing JSDoc");
    expect(result.code).not.toBe(0);
  }
});

test("internal declarations do not need JSDoc", () => {
  const result = lintFixture(
    "function internal() { return 1; } console.log(internal()); export {};",
  );
  expect(result.output).not.toContain("Missing JSDoc");
  expect(result.code).toBe(0);
});

test("documented exports pass", () => {
  const result = lintFixture(
    "/** Return the fixture value. */\nexport function sample() { return 1; }",
  );
  expect(result.code).toBe(0);
});

test("type-aware lint detects unhandled promises", () => {
  const result = lintFixture("Promise.resolve(1); export {};", true);
  expect(result.output).toContain("no-floating-promises");
  expect(result.code).not.toBe(0);
});
