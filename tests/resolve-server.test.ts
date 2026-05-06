import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveServer } from "../src/commands/connect";
import {
  writeProjectFile,
  writeRegistry,
  getServer,
  upsertServer,
  type ServerRecord,
} from "../src/config";

function makeRecord(over: Partial<ServerRecord> = {}): ServerRecord {
  return {
    name: "shared",
    server_id: 42,
    ip: "1.2.3.4",
    ipv6: null,
    ssh_port: 2137,
    user: "app",
    key_path: "/Users/x/.config/gms/keys/shared",
    ssh_key_id: 1,
    firewall_id: 2,
    firewall_owned: true,
    hetzner: { type: "cx23", location: "fsn1", image: "ubuntu-24.04" },
    created_at: "2026-01-01T00:00:00Z",
    repo_path: "/Users/alice/code/shared",
    ...over,
  };
}

const realCwd = process.cwd();
beforeEach(async () => {
  await writeRegistry({ version: 1, servers: {} });
  process.chdir(realCwd);
});

describe("resolveServer auto-imports shared .gms.json into the local registry", () => {
  test("first read seeds the registry with the current developer's repo_path", async () => {
    // Simulate Alice authoring .gms.json with her absolute path…
    const aliceProject = realpathSync(mkdtempSync(join(tmpdir(), "gms-resolve-alice-")));
    mkdirSync(join(aliceProject, ".git"));
    await writeProjectFile(aliceProject, makeRecord({ repo_path: aliceProject }));

    // …then imagine Bob clones the repo somewhere else with a different path.
    // We mimic that by chdir'ing into a path the registry has never seen.
    process.chdir(aliceProject);

    expect(await getServer("shared")).toBeNull();

    const resolved = await resolveServer();
    expect(resolved).toBeTruthy();
    expect(resolved!.name).toBe("shared");
    expect(resolved!.server_id).toBe(42);

    const imported = await getServer("shared");
    expect(imported).toBeTruthy();
    // repo_path should be the path of *this* developer's clone (== cwd here),
    // not whatever was originally in .gms.json
    expect(imported!.repo_path).toBe(aliceProject);
  });

  test("does not overwrite an existing registry entry", async () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "gms-resolve-existing-")));
    mkdirSync(join(projectDir, ".git"));
    await writeProjectFile(projectDir, makeRecord({ ip: "1.2.3.4" }));

    // pre-existing registry entry with different ip + repo_path
    await upsertServer(makeRecord({ ip: "9.9.9.9", repo_path: "/other/clone" }));

    process.chdir(projectDir);
    await resolveServer();

    const reg = await getServer("shared");
    expect(reg!.ip).toBe("9.9.9.9");
    expect(reg!.repo_path).toBe("/other/clone");
  });

  test("explicit name lookup hits the registry, not .gms.json", async () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "gms-resolve-explicit-")));
    mkdirSync(join(projectDir, ".git"));
    await writeProjectFile(projectDir, makeRecord({ name: "shared", ip: "1.1.1.1" }));
    await upsertServer(makeRecord({ name: "other", ip: "2.2.2.2" }));

    process.chdir(projectDir);

    const r = await resolveServer("other");
    expect(r!.name).toBe("other");
    expect(r!.ip).toBe("2.2.2.2");
  });
});
