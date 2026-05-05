import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

export const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "gms")
    : join(homedir(), ".config", "gms");

export const KEYS_DIR = join(CONFIG_DIR, "keys");
export const REGISTRY_PATH = join(CONFIG_DIR, "servers.json");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const PROJECT_FILE = ".gms.json";

export function findProjectFile(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function expandHome(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

export function contractHome(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~/" + path.slice(home.length + 1);
  return path;
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
