import { parse, resolveToken, UserError } from "../cli";
import { HetznerClient } from "../hetzner";
import { resolvePublicIPv4 } from "../public-ip";
import { resolveServer } from "./connect";

const USAGE = `gms firewall — manage the server's firewall

Usage:
  gms firewall allow [name] [ip|me] [--token TOK]

Adds an IP (default: your current public IP via ip.hetzner.com) to the SSH
rule of the server's firewall. Use this if your IP changed and you can no
longer SSH in.
`;

export async function runFirewall(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === "-h" || sub === "--help") {
    console.log(USAGE);
    return;
  }

  if (sub !== "allow") {
    throw new UserError(`Unknown firewall subcommand: ${sub}. Try 'gms firewall --help'.`);
  }

  await runFirewallAllow(argv.slice(1));
}

async function runFirewallAllow(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    token: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  // First positional may be a server name or "me"/IP. We disambiguate:
  // if positionals[0] looks like an IP or is "me", treat as ip with no name.
  let nameArg: string | undefined;
  let ipArg: string | undefined;
  if (positionals.length === 1) {
    if (looksLikeIp(positionals[0]!) || positionals[0] === "me") {
      ipArg = positionals[0];
    } else {
      nameArg = positionals[0];
    }
  } else if (positionals.length >= 2) {
    nameArg = positionals[0];
    ipArg = positionals[1];
  }

  const record = await resolveServer(nameArg);
  if (!record) {
    throw new UserError(
      nameArg
        ? `No server registered with name '${nameArg}'.`
        : `No server resolved. Pass a name or run inside a project with .gms.json.`,
    );
  }
  if (!record.firewall_id) {
    throw new UserError(
      `Server '${record.name}' has no firewall recorded. Nothing to update.`,
    );
  }

  let ip: string;
  if (!ipArg || ipArg === "me") {
    ip = await resolvePublicIPv4();
    console.log(`gms: resolved your public IP as ${ip}`);
  } else {
    if (!looksLikeIp(ipArg)) {
      throw new UserError(`'${ipArg}' is not a valid IPv4 address`);
    }
    ip = ipArg;
  }
  const cidr = ip.includes("/") ? ip : `${ip}/32`;

  const token = resolveToken(values.token as string | undefined);
  const client = new HetznerClient(token);
  const fw = await client.getFirewall(record.firewall_id);

  const port = String(record.ssh_port);
  let touched = false;
  const newRules = fw.rules.map((r) => {
    if (r.direction === "in" && r.protocol === "tcp" && r.port === port) {
      const sources = new Set([...(r.source_ips ?? []), cidr]);
      touched = true;
      return { ...r, source_ips: [...sources] };
    }
    return r;
  });

  if (!touched) {
    newRules.push({
      direction: "in",
      protocol: "tcp",
      port,
      source_ips: [cidr],
      description: "gms-ssh",
    });
  }

  await client.setFirewallRules(fw.id, newRules);
  console.log(`gms: ✔ allowed ${cidr} on ${port}/tcp for firewall '${fw.name}'`);
  const updated = newRules.find(
    (r) => r.direction === "in" && r.protocol === "tcp" && r.port === port,
  );
  console.log(`gms: SSH allowlist now: ${(updated?.source_ips ?? []).join(", ")}`);
}

function looksLikeIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s);
}
