#!/usr/bin/env bun
import { USAGE, UserError } from "./cli";
import { HetznerError } from "./hetzner";
import { runCreate } from "./commands/create";
import { runConnect } from "./commands/connect";
import { runList } from "./commands/list";
import { runStatus } from "./commands/status";
import { runDestroy } from "./commands/destroy";
import { runFirewall } from "./commands/firewall";
import { runSetup } from "./commands/setup";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(USAGE);
    return;
  }

  switch (cmd) {
    case "setup":
      return await runSetup(rest);
    case "create":
      return await runCreate(rest);
    case "connect":
      return await runConnect(rest);
    case "list":
    case "ls":
      return await runList(rest);
    case "status":
      return await runStatus(rest);
    case "destroy":
    case "rm":
      return await runDestroy(rest);
    case "firewall":
    case "fw":
      return await runFirewall(rest);
    default:
      console.error(`gms: unknown command '${cmd}'\n`);
      process.stdout.write(USAGE);
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  if (err instanceof UserError) {
    console.error(`gms: ${err.message}`);
    process.exit(2);
  }
  if (err instanceof HetznerError) {
    console.error(`gms: Hetzner API error: ${err.message}` + (err.code ? ` (${err.code})` : ""));
    process.exit(1);
  }
  console.error(`gms: ${(err as Error).message ?? err}`);
  process.exit(1);
});
