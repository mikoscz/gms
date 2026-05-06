import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertServer,
  getServer,
  listServers,
  removeServer,
  readRegistry,
  writeRegistry,
  writeProjectFile,
  readProjectFile,
  deleteProjectFile,
  type ServerRecord,
} from "../src/config";
import { CONFIG_DIR, REGISTRY_PATH } from "../src/paths";

function makeRecord(over: Partial<ServerRecord> = {}): ServerRecord {
  return {
    name: "demo",
    server_id: 100,
    ip: "1.2.3.4",
    ipv6: null,
    ssh_port: 2137,
    user: "app",
    key_path: join(process.env.HOME ?? "/home/x", ".config/gms/keys/demo"),
    ssh_key_id: 50,
    firewall_id: 60,
    firewall_owned: true,
    hetzner: { type: "cx23", location: "fsn1", image: "ubuntu-24.04" },
    created_at: "2026-01-01T00:00:00Z",
    repo_path: "/path/to/repo",
    ...over,
  };
}

beforeEach(async () => {
  await writeRegistry({ version: 1, servers: {} });
});

describe("registry round-trip", () => {
  test("upsertServer + getServer", async () => {
    await upsertServer(makeRecord({ name: "alpha" }));
    const got = await getServer("alpha");
    expect(got).toBeTruthy();
    expect(got!.server_id).toBe(100);
  });

  test("getServer returns null when absent", async () => {
    expect(await getServer("ghost")).toBeNull();
  });

  test("upsertServer overwrites by name", async () => {
    await upsertServer(makeRecord({ name: "alpha", ip: "1.1.1.1" }));
    await upsertServer(makeRecord({ name: "alpha", ip: "9.9.9.9" }));
    const got = await getServer("alpha");
    expect(got!.ip).toBe("9.9.9.9");
  });

  test("listServers returns every entry", async () => {
    await upsertServer(makeRecord({ name: "alpha" }));
    await upsertServer(makeRecord({ name: "beta", server_id: 200 }));
    const all = await listServers();
    const names = all.map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("removeServer deletes and returns the prior record", async () => {
    await upsertServer(makeRecord({ name: "alpha" }));
    const removed = await removeServer("alpha");
    expect(removed).toBeTruthy();
    expect(removed!.server_id).toBe(100);
    expect(await getServer("alpha")).toBeNull();
  });

  test("removeServer returns null when name does not exist", async () => {
    expect(await removeServer("nope")).toBeNull();
  });

  test("registry file is written under XDG_CONFIG_HOME/gms (isolated tmpdir)", async () => {
    await upsertServer(makeRecord({ name: "alpha" }));
    expect(REGISTRY_PATH.startsWith(CONFIG_DIR)).toBe(true);
    expect(existsSync(REGISTRY_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.servers.alpha).toBeTruthy();
  });

  test("key_path is stored with ~ contraction on disk but expanded on read", async () => {
    await upsertServer(makeRecord({ name: "alpha" }));
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    expect(raw.servers.alpha.key_path.startsWith("~/")).toBe(true);
    const back = await getServer("alpha");
    expect(back!.key_path.startsWith("/")).toBe(true);
  });

  test("readRegistry returns empty when file is malformed", async () => {
    writeFileSync(REGISTRY_PATH, "{ this is not json");
    const reg = await readRegistry();
    expect(reg.servers).toEqual({});
  });
});

describe(".gms.json round-trip", () => {
  test("writeProjectFile / readProjectFile preserve fields and expand ~", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-cfg-proj-"));
    const record = makeRecord({ name: "proj", server_id: 555 });
    const path = await writeProjectFile(dir, record);
    expect(path).toBe(join(dir, ".gms.json"));

    const loaded = await readProjectFile(path);
    expect(loaded.name).toBe("proj");
    expect(loaded.server_id).toBe(555);
    expect(loaded.key_path).toBe(record.key_path);
  });

  test("repo_path is stripped from .gms.json so the file is shareable across developers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-cfg-proj-"));
    const record = makeRecord({ name: "proj", repo_path: "/Users/alice/code/proj" });
    const path = await writeProjectFile(dir, record);

    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.repo_path).toBeUndefined();
    expect(raw.name).toBe("proj");
    expect(raw.server_id).toBe(record.server_id);

    const loaded = await readProjectFile(path);
    expect(loaded.repo_path).toBeUndefined();
  });

  test("readProjectFile still accepts legacy .gms.json files that include repo_path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-cfg-proj-"));
    const path = join(dir, ".gms.json");
    const legacy = {
      ...makeRecord({ name: "legacy" }),
      repo_path: "/old/abs/path",
    };
    writeFileSync(path, JSON.stringify(legacy));
    const loaded = await readProjectFile(path);
    expect(loaded.name).toBe("legacy");
    // legacy files keep their stored repo_path on read; writes will strip it
    expect(loaded.repo_path).toBe("/old/abs/path");
  });

  test("deleteProjectFile is a no-op when the file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-cfg-proj-"));
    await deleteProjectFile(join(dir, ".gms.json"));
  });
});
