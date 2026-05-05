import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { findProjectFile, findProjectRoot, expandHome, contractHome } from "../src/paths";

describe("expandHome / contractHome", () => {
  test("expandHome turns ~ into $HOME", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/foo/bar")).toBe(join(homedir(), "foo/bar"));
  });

  test("expandHome leaves absolute and relative paths alone", () => {
    expect(expandHome("/etc/passwd")).toBe("/etc/passwd");
    expect(expandHome("./foo")).toBe("./foo");
    expect(expandHome("foo")).toBe("foo");
  });

  test("contractHome inverts expandHome for paths under $HOME", () => {
    expect(contractHome(homedir())).toBe("~");
    expect(contractHome(join(homedir(), "foo"))).toBe("~/foo");
    expect(contractHome("/etc/passwd")).toBe("/etc/passwd");
  });

  test("expandHome / contractHome roundtrip", () => {
    const original = join(homedir(), "a/b/c");
    expect(expandHome(contractHome(original))).toBe(original);
  });
});

describe("findProjectFile", () => {
  test("finds .gms.json in cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-paths-"));
    writeFileSync(join(dir, ".gms.json"), "{}");
    expect(findProjectFile(dir)).toBe(join(dir, ".gms.json"));
  });

  test("finds .gms.json walking up from a subdir", () => {
    const root = mkdtempSync(join(tmpdir(), "gms-paths-"));
    const sub = join(root, "a/b/c");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(root, ".gms.json"), "{}");
    expect(findProjectFile(sub)).toBe(join(root, ".gms.json"));
  });

  test("returns null when no .gms.json exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-paths-"));
    expect(findProjectFile(dir)).toBeNull();
  });

  test("stops at .git boundary", () => {
    // outer/.gms.json   ← should NOT be found from outer/repo/sub
    // outer/repo/.git
    // outer/repo/sub
    const outer = mkdtempSync(join(tmpdir(), "gms-paths-"));
    writeFileSync(join(outer, ".gms.json"), "{}");
    const repo = join(outer, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const sub = join(repo, "sub");
    mkdirSync(sub);
    expect(findProjectFile(sub)).toBeNull();
  });
});

describe("findProjectRoot", () => {
  test("returns the .git-bearing ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "gms-paths-"));
    mkdirSync(join(root, ".git"));
    const sub = join(root, "a/b");
    mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(root);
  });

  test("falls back to the start dir when no .git is found", () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-paths-"));
    expect(findProjectRoot(dir)).toBe(dir);
  });
});
