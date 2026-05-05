import { readFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { KEYS_DIR } from "./paths";

export interface KeyPair {
  privatePath: string;
  publicPath: string;
  publicKey: string;
}

export async function generateKeyPair(name: string, comment: string): Promise<KeyPair> {
  if (!existsSync(KEYS_DIR)) await mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });
  const privatePath = join(KEYS_DIR, name);
  const publicPath = `${privatePath}.pub`;

  if (existsSync(privatePath) || existsSync(publicPath)) {
    throw new Error(
      `Key files already exist at ${privatePath}{,.pub}. Refusing to overwrite. ` +
        `Pass --pubkey to reuse an existing key, or delete these files first.`,
    );
  }

  // Bun's $ template drops empty-string args, which mangles `-N ""`. Use spawn
  // so the argv is passed verbatim.
  const proc = Bun.spawn(
    ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", comment, "-f", privatePath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    const stdout = (await new Response(proc.stdout).text()).trim();
    throw new Error(
      `ssh-keygen failed (exit ${exitCode}): ${stderr || stdout || "no output"}`,
    );
  }

  await chmod(privatePath, 0o600);
  await chmod(publicPath, 0o644);

  const publicKey = (await readFile(publicPath, "utf8")).trim();
  return { privatePath, publicPath, publicKey };
}

export async function readPubkey(path: string): Promise<string> {
  const text = (await readFile(path, "utf8")).trim();
  if (!text.startsWith("ssh-") && !text.startsWith("ecdsa-")) {
    throw new Error(`File at ${path} does not look like a public key`);
  }
  return text;
}
