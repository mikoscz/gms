import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR,
  KEYS_DIR,
  REGISTRY_PATH,
  CONFIG_PATH,
  PROJECT_FILE,
  expandHome,
  contractHome,
} from "./paths";

export interface ServerRecord {
  name: string;
  server_id: number;
  ip: string;
  ipv6: string | null;
  ssh_port: number;
  user: string;
  key_path: string;
  ssh_key_id: number;
  firewall_id: number | null;
  firewall_owned: boolean;
  hetzner: {
    type: string;
    location: string;
    image: string;
  };
  created_at: string;
  repo_path?: string;
}

export interface Registry {
  version: 1;
  servers: Record<string, ServerRecord>;
}

export interface GlobalConfig {
  version: 1;
  defaults?: {
    type?: string;
    location?: string;
    image?: string;
    user?: string;
    ssh_port?: number;
  };
}

export async function ensureConfigDirs(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(KEYS_DIR)) await mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });
}

export async function readRegistry(): Promise<Registry> {
  if (!existsSync(REGISTRY_PATH)) return { version: 1, servers: {} };
  const text = await readFile(REGISTRY_PATH, "utf8");
  try {
    const parsed = JSON.parse(text) as Registry;
    if (!parsed.servers) parsed.servers = {};
    return parsed;
  } catch {
    return { version: 1, servers: {} };
  }
}

export async function writeRegistry(reg: Registry): Promise<void> {
  await ensureConfigDirs();
  await writeFile(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
}

export async function upsertServer(record: ServerRecord): Promise<void> {
  const reg = await readRegistry();
  reg.servers[record.name] = { ...record, key_path: contractHome(record.key_path) };
  await writeRegistry(reg);
}

export async function removeServer(name: string): Promise<ServerRecord | null> {
  const reg = await readRegistry();
  const existing = reg.servers[name];
  if (!existing) return null;
  delete reg.servers[name];
  await writeRegistry(reg);
  return hydrate(existing);
}

export async function getServer(name: string): Promise<ServerRecord | null> {
  const reg = await readRegistry();
  const r = reg.servers[name];
  return r ? hydrate(r) : null;
}

export async function listServers(): Promise<ServerRecord[]> {
  const reg = await readRegistry();
  return Object.values(reg.servers).map(hydrate);
}

function hydrate(r: ServerRecord): ServerRecord {
  return { ...r, key_path: expandHome(r.key_path) };
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  if (!existsSync(CONFIG_PATH)) return { version: 1 };
  try {
    const text = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(text) as GlobalConfig;
  } catch {
    return { version: 1 };
  }
}

// per-project .gms.json — committed to the repo, shared across developers.
// `repo_path` is intentionally stripped because it's specific to where each
// developer has cloned the repo on disk; it lives only in the per-machine
// registry (servers.json).
export async function writeProjectFile(dir: string, record: ServerRecord): Promise<string> {
  const path = join(dir, PROJECT_FILE);
  const { repo_path: _repoPath, ...portable } = record;
  const stored = { ...portable, key_path: contractHome(record.key_path) };
  await writeFile(path, JSON.stringify(stored, null, 2) + "\n");
  return path;
}

export async function readProjectFile(path: string): Promise<ServerRecord> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as Omit<ServerRecord, "repo_path"> & { repo_path?: string };
  return hydrate(parsed as ServerRecord);
}

export async function deleteProjectFile(path: string): Promise<void> {
  if (existsSync(path)) await unlink(path);
}
