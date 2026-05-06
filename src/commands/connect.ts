import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";
import { parse, UserError } from "../cli";
import { findProjectFile, findProjectRoot } from "../paths";
import { getServer, readProjectFile, upsertServer, type ServerRecord } from "../config";

const USAGE = `gms connect — SSH into the project's server

Usage:
  gms connect [name]

Looks for .gms.json walking up from cwd. Falls back to the global registry
keyed by repo basename.
`;

export async function runConnect(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const explicit = positionals[0];
  const record = await resolveServer(explicit);

  if (!record) {
    throw new UserError(
      explicit
        ? `No server registered with name '${explicit}'. Try 'gms list'.`
        : `No .gms.json found above cwd and no matching server in the registry. Run 'gms create' or 'gms setup' first, or pass an explicit name.`,
    );
  }

  const args = [
    "-i",
    record.key_path,
    "-p",
    String(record.ssh_port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${record.user}@${record.ip}`,
  ];

  console.log(`gms: ssh ${args.join(" ")}`);
  const child = spawn("ssh", args, { stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
    child.on("error", reject);
  });
}

export async function resolveServer(explicit?: string): Promise<ServerRecord | null> {
  if (explicit) return await getServer(explicit);

  const localFile = findProjectFile();
  if (localFile) {
    const record = await readProjectFile(localFile);
    // First time this developer touches a shared .gms.json: seed the global
    // registry so `gms list` and `gms status` find it without needing to be
    // run from inside the repo.
    const existing = await getServer(record.name);
    if (!existing) {
      await upsertServer({ ...record, repo_path: dirname(localFile) });
      console.error(`gms: imported '${record.name}' from ${localFile} into your local registry`);
    }
    return record;
  }

  const guess = basename(findProjectRoot());
  return await getServer(guess);
}
