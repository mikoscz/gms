import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse, resolveToken, UserError } from "../cli";
import { HetznerClient, HetznerError } from "../hetzner";
import { deleteProjectFile, removeServer } from "../config";
import { resolveServer } from "./connect";
import { findProjectFile } from "../paths";
import { confirm } from "../prompt";

const USAGE = `gms destroy — tear down a server

Usage:
  gms destroy [name] [--keep-keys] [--yes] [--token TOK]

Deletes the Hetzner server, the auto-created firewall (if any), the SSH key,
the local keypair (unless --keep-keys), the registry entry, and the project's
.gms.json (if it points at this server).
`;

export async function runDestroy(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    token: { type: "string" },
    "keep-keys": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const record = await resolveServer(positionals[0]);
  if (!record) {
    throw new UserError(
      positionals[0]
        ? `No server registered with name '${positionals[0]}'.`
        : `No server resolved. Pass a name or run inside a project with .gms.json.`,
    );
  }

  if (!values.yes) {
    const ok = await confirm(
      `Destroy '${record.name}' (id=${record.server_id}, ${record.ip})?`,
      false,
    );
    if (!ok) {
      console.log("aborted");
      return;
    }
  }

  const token = resolveToken(values.token as string | undefined);
  const client = new HetznerClient(token);

  // Delete server
  try {
    await client.deleteServer(record.server_id);
    console.log(`gms: deleted server ${record.server_id}`);
  } catch (e) {
    if (e instanceof HetznerError && e.status === 404) {
      console.log(`gms: server ${record.server_id} already gone`);
    } else throw e;
  }

  // Delete owned firewall
  if (record.firewall_owned && record.firewall_id) {
    try {
      await client.deleteFirewall(record.firewall_id);
      console.log(`gms: deleted firewall ${record.firewall_id}`);
    } catch (e) {
      if (e instanceof HetznerError && e.status === 404) {
        // already gone
      } else {
        console.error(`gms: failed to delete firewall: ${(e as Error).message}`);
      }
    }
  }

  // Delete SSH key
  try {
    await client.deleteSshKey(record.ssh_key_id);
    console.log(`gms: deleted SSH key ${record.ssh_key_id}`);
  } catch (e) {
    if (e instanceof HetznerError && e.status === 404) {
      // already gone
    } else {
      console.error(`gms: failed to delete SSH key: ${(e as Error).message}`);
    }
  }

  // Local keypair
  if (!values["keep-keys"]) {
    for (const p of [record.key_path, `${record.key_path}.pub`]) {
      if (existsSync(p)) {
        try {
          await unlink(p);
        } catch (e) {
          console.error(`gms: failed to remove ${p}: ${(e as Error).message}`);
        }
      }
    }
    console.log(`gms: removed local keypair`);
  }

  // Registry
  await removeServer(record.name);

  // .gms.json (only if it points at this server)
  const localFile = findProjectFile();
  if (localFile) {
    try {
      const text = await Bun.file(localFile).text();
      const parsed = JSON.parse(text);
      if (parsed?.server_id === record.server_id) {
        await deleteProjectFile(localFile);
        console.log(`gms: removed ${localFile}`);
      }
    } catch {}
  }

  console.log(`gms: ✔ '${record.name}' destroyed`);
}
