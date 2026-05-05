import { test, expect, describe } from "bun:test";
import { writeFileSync, mkdtempSync, statSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, readPubkey } from "../src/ssh-keys";
import { KEYS_DIR } from "../src/paths";

describe("readPubkey", () => {
  test("returns the trimmed contents for an ssh-* key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-keys-"));
    const path = join(dir, "id.pub");
    writeFileSync(path, "ssh-ed25519 AAAA…   test\n");
    expect(await readPubkey(path)).toBe("ssh-ed25519 AAAA…   test");
  });

  test("rejects files that don't look like a public key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gms-keys-"));
    const path = join(dir, "garbage.pub");
    writeFileSync(path, "this is not a key");
    await expect(readPubkey(path)).rejects.toThrow(/does not look like a public key/);
  });
});

describe("generateKeyPair", () => {
  test("creates ed25519 keypair under KEYS_DIR with correct perms", async () => {
    const name = `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const kp = await generateKeyPair(name, `gms-${name}`);
    try {
      expect(kp.privatePath).toBe(join(KEYS_DIR, name));
      expect(kp.publicPath).toBe(join(KEYS_DIR, `${name}.pub`));
      expect(kp.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
      expect(kp.publicKey).toContain(`gms-${name}`);

      const privMode = statSync(kp.privatePath).mode & 0o777;
      const pubMode = statSync(kp.publicPath).mode & 0o777;
      expect(privMode).toBe(0o600);
      expect(pubMode).toBe(0o644);
    } finally {
      if (existsSync(kp.privatePath)) unlinkSync(kp.privatePath);
      if (existsSync(kp.publicPath)) unlinkSync(kp.publicPath);
    }
  });

  test("refuses to overwrite an existing keypair", async () => {
    const name = `unit-existing-${Date.now()}`;
    const kp = await generateKeyPair(name, `gms-${name}`);
    try {
      await expect(generateKeyPair(name, `gms-${name}`)).rejects.toThrow(
        /Key files already exist/,
      );
    } finally {
      if (existsSync(kp.privatePath)) unlinkSync(kp.privatePath);
      if (existsSync(kp.publicPath)) unlinkSync(kp.publicPath);
    }
  });
});
