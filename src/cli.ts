import { parseArgs as nodeParseArgs, type ParseArgsConfig } from "node:util";
import { basename } from "node:path";
import { findProjectRoot } from "./paths";

export const DEFAULTS = {
  type: "cx23",
  location: "fsn1",
  image: "ubuntu-24.04",
  user: "app",
  ssh_port: 2137,
} as const;

export function parse<O extends NonNullable<ParseArgsConfig["options"]>>(
  argv: string[],
  options: O,
) {
  return nodeParseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  });
}

export function defaultServerName(): string {
  return basename(findProjectRoot());
}

export function resolveToken(flagValue?: string): string {
  const token = flagValue || process.env.HCLOUD_TOKEN || "";
  if (!token) {
    throw new UserError(
      "Hetzner token required. Pass --token or set HCLOUD_TOKEN.",
    );
  }
  return token;
}

export class UserError extends Error {}

export const USAGE = `gms — Hetzner provisioning CLI

Usage:
  gms setup                        Interactive wizard (recommended for first-time use)
  gms create [options]             Provision and harden a new server
  gms connect [name]               SSH into the project's server
  gms list                         List registered servers
  gms status [name]                Show live status from Hetzner
  gms destroy [name] [--yes]       Tear down server, firewall, key
  gms firewall allow [name] [ip|me]  Add an IP to the SSH firewall rule

Run 'gms <command> --help' for command-specific options.

Environment:
  HCLOUD_TOKEN        Hetzner Cloud API token (alternative to --token)
`;

export const CREATE_USAGE = `gms create — provision a new Hetzner server

Options:
  --token <token>           Hetzner API token (or HCLOUD_TOKEN env)
  --name <name>             Server/registry name. Default: current repo basename
  --type <type>             Server type. Default: ${DEFAULTS.type}
  --location <loc>          Datacenter. Default: ${DEFAULTS.location}
  --image <image>           OS image. Default: ${DEFAULTS.image}
  --user <user>             Non-root user to create. Default: ${DEFAULTS.user}
  --ssh-port <port>         Custom SSH port. Default: ${DEFAULTS.ssh_port}
  --firewall <id|name>      Attach existing firewall instead of creating one
  --no-firewall             Don't create or attach a firewall
  --no-http                 Don't open ports 80/443 in the auto-created firewall
  --firewall-port <port>    Additional TCP port to open (repeatable)
  --ssh-from-anywhere       Allow SSH from 0.0.0.0/0 (default: only your current IP)
  --pubkey <path>           Use existing public key instead of generating one
  --no-harden               Skip hardening (ufw/fail2ban/unattended-upgrades)
  --dry-run                 Print plan without making API calls
  -h, --help                Show this help
`;
