import { parse } from "../cli";
import { listServers } from "../config";

const USAGE = `gms list — list registered servers

Usage:
  gms list
`;

export async function runList(argv: string[]): Promise<void> {
  const { values } = parse(argv, { help: { type: "boolean", short: "h" } });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const servers = await listServers();
  if (servers.length === 0) {
    console.log("(no servers registered — run 'gms create' or 'gms setup')");
    return;
  }

  const rows = servers.map((s) => ({
    NAME: s.name,
    IP: s.ip,
    PORT: String(s.ssh_port),
    USER: s.user,
    TYPE: s.hetzner.type,
    LOCATION: s.hetzner.location,
    CREATED: s.created_at.split("T")[0] ?? s.created_at,
  }));

  const cols = ["NAME", "IP", "PORT", "USER", "TYPE", "LOCATION", "CREATED"] as const;
  const widths: Record<string, number> = {};
  for (const c of cols) {
    widths[c] = Math.max(c.length, ...rows.map((r) => (r as any)[c].length));
  }

  const fmt = (row: Record<string, string>) =>
    cols.map((c) => row[c]!.padEnd(widths[c]!)).join("  ");

  console.log(fmt(Object.fromEntries(cols.map((c) => [c, c]))));
  for (const r of rows) console.log(fmt(r as any));
}
