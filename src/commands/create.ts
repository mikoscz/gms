import { unlink } from "node:fs/promises";
import { CREATE_USAGE, DEFAULTS, defaultServerName, parse, resolveToken, UserError } from "../cli";
import { findProjectRoot } from "../paths";
import { HetznerClient, type HetznerFirewall, type HetznerFirewallRule } from "../hetzner";
import { ensureConfigDirs, upsertServer, writeProjectFile, type ServerRecord } from "../config";
import { generateKeyPair, readPubkey } from "../ssh-keys";
import { renderCloudInit } from "../cloud-init";
import { resolvePublicIPv4 } from "../public-ip";

export interface CreateOptions {
  token?: string;
  name?: string;
  type?: string;
  location?: string;
  image?: string;
  user?: string;
  sshPort?: number;
  firewall?: string;
  noFirewall?: boolean;
  noHttp?: boolean;
  firewallPorts?: number[];
  sshFromAnywhere?: boolean;
  pubkey?: string;
  noHarden?: boolean;
  dryRun?: boolean;
  projectDir?: string;
}

export async function runCreate(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    token: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    location: { type: "string" },
    image: { type: "string" },
    user: { type: "string" },
    "ssh-port": { type: "string" },
    firewall: { type: "string" },
    "no-firewall": { type: "boolean" },
    "no-http": { type: "boolean" },
    "firewall-port": { type: "string", multiple: true },
    "ssh-from-anywhere": { type: "boolean" },
    pubkey: { type: "string" },
    "no-harden": { type: "boolean" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });

  if (values.help) {
    console.log(CREATE_USAGE);
    return;
  }

  if (positionals.length > 0) {
    throw new UserError(`Unexpected positional argument: ${positionals[0]}`);
  }

  const sshPort = values["ssh-port"] ? Number(values["ssh-port"]) : undefined;
  const firewallPorts = (values["firewall-port"] as string[] | undefined)?.map(Number);

  if (sshPort !== undefined && (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) {
    throw new UserError(`--ssh-port must be 1-65535`);
  }
  if (firewallPorts?.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new UserError(`--firewall-port values must be 1-65535`);
  }

  await create({
    token: values.token as string | undefined,
    name: values.name as string | undefined,
    type: values.type as string | undefined,
    location: values.location as string | undefined,
    image: values.image as string | undefined,
    user: values.user as string | undefined,
    sshPort,
    firewall: values.firewall as string | undefined,
    noFirewall: values["no-firewall"] as boolean | undefined,
    noHttp: values["no-http"] as boolean | undefined,
    firewallPorts,
    sshFromAnywhere: values["ssh-from-anywhere"] as boolean | undefined,
    pubkey: values.pubkey as string | undefined,
    noHarden: values["no-harden"] as boolean | undefined,
    dryRun: values["dry-run"] as boolean | undefined,
  });
}

export async function create(opts: CreateOptions): Promise<ServerRecord | null> {
  const token = opts.dryRun ? (opts.token ?? process.env.HCLOUD_TOKEN ?? "") : resolveToken(opts.token);
  const name = opts.name || defaultServerName();
  const type = opts.type || DEFAULTS.type;
  const location = opts.location || DEFAULTS.location;
  const image = opts.image || DEFAULTS.image;
  const user = opts.user || DEFAULTS.user;
  const sshPort = opts.sshPort ?? DEFAULTS.ssh_port;
  const harden = !opts.noHarden;
  const projectDir = opts.projectDir || findProjectRoot();

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new UserError(
      `Server name '${name}' is invalid. Must match [a-zA-Z0-9][a-zA-Z0-9._-]*. Pass --name.`,
    );
  }

  console.log(`gms: provisioning '${name}' (${type} @ ${location}, ${image})`);

  // 1. SSH key — generate or read existing
  await ensureConfigDirs();
  let publicKey: string;
  let keyPath: string;
  let generatedKeys = false;
  if (opts.pubkey) {
    publicKey = await readPubkey(opts.pubkey);
    keyPath = opts.pubkey.replace(/\.pub$/, "");
    console.log(`gms: using existing pubkey ${opts.pubkey}`);
  } else {
    if (opts.dryRun) {
      publicKey = "ssh-ed25519 AAAA...DRYRUN gms-" + name;
      keyPath = `~/.config/gms/keys/${name}`;
      console.log(`gms: [dry-run] would generate ed25519 keypair at ${keyPath}{,.pub}`);
    } else {
      const kp = await generateKeyPair(name, `gms-${name}`);
      publicKey = kp.publicKey;
      keyPath = kp.privatePath;
      generatedKeys = true;
      console.log(`gms: generated ed25519 keypair at ${kp.privatePath}{,.pub}`);
    }
  }

  // 2. Resolve public IPv4 (unless ssh-from-anywhere)
  let mySourceIPs: string[] = ["0.0.0.0/0", "::/0"];
  if (!opts.sshFromAnywhere && !opts.firewall && !opts.noFirewall) {
    try {
      const ip = await resolvePublicIPv4();
      mySourceIPs = [`${ip}/32`];
      console.log(`gms: SSH source restricted to your current IP ${ip}/32 (override with --ssh-from-anywhere)`);
    } catch (e) {
      throw new UserError(
        `Could not resolve your public IP via ip.hetzner.com: ${(e as Error).message}\n` +
          `Pass --ssh-from-anywhere to allow SSH from any IP, or use --firewall <existing>.`,
      );
    }
  }

  // 3. Firewall rules (used in either dry-run preview or real create)
  const fwRules: HetznerFirewallRule[] = [];
  if (!opts.firewall && !opts.noFirewall) {
    fwRules.push({
      direction: "in",
      protocol: "tcp",
      port: String(sshPort),
      source_ips: mySourceIPs,
      description: "gms-ssh",
    });
    if (!opts.noHttp) {
      fwRules.push({
        direction: "in",
        protocol: "tcp",
        port: "80",
        source_ips: ["0.0.0.0/0", "::/0"],
        description: "gms-http",
      });
      fwRules.push({
        direction: "in",
        protocol: "tcp",
        port: "443",
        source_ips: ["0.0.0.0/0", "::/0"],
        description: "gms-https",
      });
    }
    for (const p of opts.firewallPorts ?? []) {
      fwRules.push({
        direction: "in",
        protocol: "tcp",
        port: String(p),
        source_ips: ["0.0.0.0/0", "::/0"],
        description: `gms-extra-${p}`,
      });
    }
  }

  // 4. Cloud-init
  const userData = renderCloudInit({ user, publicKey, sshPort, harden });

  if (opts.dryRun) {
    console.log("\n--- DRY RUN: planned actions ---");
    console.log(`POST /v1/ssh_keys  name=gms-${name}`);
    if (opts.firewall) {
      console.log(`GET  /v1/firewalls (lookup '${opts.firewall}')`);
    } else if (!opts.noFirewall) {
      console.log(`POST /v1/firewalls name=gms-${name} rules=${fwRules.length}`);
      for (const r of fwRules) {
        console.log(`  - ${r.direction} ${r.protocol}/${r.port} from ${(r.source_ips ?? []).join(",")} (${r.description})`);
      }
    } else {
      console.log("(no firewall — --no-firewall)");
    }
    console.log(
      `POST /v1/servers   name=${name} type=${type} location=${location} image=${image} harden=${harden}`,
    );
    console.log("\n--- cloud-init payload ---");
    console.log(userData);
    return null;
  }

  const client = new HetznerClient(token);

  // 5. Upload SSH key
  const sshKey = await client.createSshKey(`gms-${name}`, publicKey);
  console.log(`gms: uploaded SSH key (id=${sshKey.id})`);

  let firewall: HetznerFirewall | null = null;
  let firewallOwned = false;

  try {
    // 6. Firewall
    if (opts.firewall) {
      const asId = Number(opts.firewall);
      if (Number.isInteger(asId) && asId > 0) {
        firewall = await client.getFirewall(asId);
      } else {
        firewall = await client.findFirewallByName(opts.firewall);
        if (!firewall) {
          throw new UserError(`Firewall '${opts.firewall}' not found`);
        }
      }
      console.log(`gms: attaching existing firewall '${firewall.name}' (id=${firewall.id})`);
    } else if (!opts.noFirewall) {
      firewall = await client.createFirewall(`gms-${name}`, fwRules);
      firewallOwned = true;
      console.log(`gms: created firewall 'gms-${name}' (id=${firewall.id})`);
    }

    // 7. Server
    const result = await client.createServer({
      name,
      server_type: type,
      location,
      image,
      ssh_keys: [sshKey.id],
      firewalls: firewall ? [{ firewall: firewall.id }] : undefined,
      user_data: userData,
    });
    const server = result.server;
    console.log(`gms: server created (id=${server.id}); waiting for boot…`);

    // Wait for the create action to complete
    await client.waitForAction(result.action.id, { timeoutMs: 180_000 });

    // Refresh server (status, IP)
    const fresh = await client.getServer(server.id);
    const ipv4 = fresh.public_net.ipv4?.ip ?? "";
    const ipv6 = fresh.public_net.ipv6?.ip ?? null;

    if (!ipv4) {
      throw new Error("Server has no IPv4 — Hetzner returned no public_net.ipv4");
    }

    const record: ServerRecord = {
      name,
      server_id: fresh.id,
      ip: ipv4,
      ipv6,
      ssh_port: sshPort,
      user,
      key_path: keyPath,
      ssh_key_id: sshKey.id,
      firewall_id: firewall?.id ?? null,
      firewall_owned: firewallOwned,
      hetzner: { type, location, image },
      created_at: fresh.created,
      repo_path: projectDir,
    };

    await writeProjectFile(projectDir, record);
    await upsertServer(record);

    console.log(`\ngms: ✔ '${name}' is up`);
    console.log(`  IPv4:    ${ipv4}`);
    if (ipv6) console.log(`  IPv6:    ${ipv6}`);
    console.log(`  SSH:     ssh -i ${keyPath} -p ${sshPort} ${user}@${ipv4}`);
    console.log(`  Connect: gms connect`);
    console.log(`\nNote: cloud-init is still running (apt upgrade + harden). SSH may need 1–3 minutes.`);

    return record;
  } catch (err) {
    // Best-effort rollback for things we created in this run
    console.error(`gms: ✖ provisioning failed: ${(err as Error).message}`);
    try {
      if (firewallOwned && firewall) {
        await client.deleteFirewall(firewall.id);
        console.error(`gms: rolled back firewall ${firewall.id}`);
      }
    } catch (e) {
      console.error(`gms: failed to roll back firewall: ${(e as Error).message}`);
    }
    try {
      await client.deleteSshKey(sshKey.id);
      console.error(`gms: rolled back SSH key ${sshKey.id}`);
    } catch (e) {
      console.error(`gms: failed to roll back SSH key: ${(e as Error).message}`);
    }
    if (generatedKeys) {
      try {
        await unlink(keyPath);
        await unlink(`${keyPath}.pub`);
      } catch {}
    }
    throw err;
  }
}
