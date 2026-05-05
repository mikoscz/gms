import { parse, resolveToken, UserError } from "../cli";
import { HetznerClient } from "../hetzner";
import { resolveServer } from "./connect";

const USAGE = `gms status — show live server status from Hetzner

Usage:
  gms status [name] [--token TOK]
`;

export async function runStatus(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    token: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const record = await resolveServer(positionals[0]);
  if (!record) {
    throw new UserError(`No server resolved. Pass a name or run inside a project with .gms.json.`);
  }

  const token = resolveToken(values.token as string | undefined);
  const client = new HetznerClient(token);
  const server = await client.getServer(record.server_id);

  console.log(`Name:      ${server.name}`);
  console.log(`Status:    ${server.status}`);
  console.log(`Type:      ${server.server_type.name}`);
  console.log(`Location:  ${server.datacenter.location.name}`);
  console.log(`Image:     ${server.image.name ?? server.image.description}`);
  console.log(`IPv4:      ${server.public_net.ipv4?.ip ?? "(none)"}`);
  console.log(`IPv6:      ${server.public_net.ipv6?.ip ?? "(none)"}`);
  console.log(`SSH:       ssh -i ${record.key_path} -p ${record.ssh_port} ${record.user}@${server.public_net.ipv4?.ip ?? record.ip}`);
}
