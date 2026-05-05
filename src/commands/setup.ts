import { DEFAULTS, defaultServerName } from "../cli";
import { ask, confirm, selectOne } from "../prompt";
import { resolvePublicIPv4 } from "../public-ip";
import { create } from "./create";

export async function runSetup(_argv: string[]): Promise<void> {
  console.log("gms setup — interactive provisioning wizard\n");
  console.log("This will create a Hetzner server, generate an SSH keypair,");
  console.log("create a firewall, and harden the box. You can press Enter at");
  console.log("each step to accept the [default].\n");

  // 1. Token
  const token = await ask("Hetzner Cloud API token", {
    hint: "Generate one at console.hetzner.cloud → Security → API Tokens. Read+write scope.",
    default: process.env.HCLOUD_TOKEN,
    mask: true,
    validate: (v) => (v.length < 20 ? "looks too short for a Hetzner token" : null),
  });

  // 2. Name
  const name = await ask("Server name", {
    hint: "Used as the Hetzner server name and the local key filename. Default is the current repo basename.",
    default: defaultServerName(),
    validate: (v) =>
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v) ? null : "must match [a-zA-Z0-9][a-zA-Z0-9._-]*",
  });

  // 3. Type
  const type = await selectOne(
    "Server type",
    [
      { value: "cx22", label: "cx22  — 2 vCPU / 4 GB  (~€3.3/mo)" },
      { value: "cx23", label: "cx23  — 2 vCPU / 4 GB  (~€4/mo) (default)" },
      { value: "cx32", label: "cx32  — 4 vCPU / 8 GB  (~€7/mo)" },
      { value: "cpx31", label: "cpx31 — 4 vCPU / 8 GB AMD (~€8/mo)" },
    ],
    DEFAULTS.type,
    "Hetzner instance size. Bigger = faster and pricier. cx23 is the small dev default.",
  );

  // 4. Location
  const location = await selectOne(
    "Datacenter location",
    [
      { value: "fsn1", label: "fsn1 — Falkenstein, DE (default)" },
      { value: "nbg1", label: "nbg1 — Nuremberg, DE" },
      { value: "hel1", label: "hel1 — Helsinki, FI" },
      { value: "ash", label: "ash  — Ashburn, US-East" },
      { value: "hil", label: "hil  — Hillsboro, US-West" },
      { value: "sin", label: "sin  — Singapore" },
    ],
    DEFAULTS.location,
    "Closer = lower latency for SSH and inbound traffic.",
  );

  // 5. Image
  const image = await selectOne(
    "OS image",
    [
      { value: "ubuntu-24.04", label: "ubuntu-24.04 (default, recommended)" },
      { value: "ubuntu-22.04", label: "ubuntu-22.04" },
      { value: "debian-12", label: "debian-12" },
    ],
    DEFAULTS.image,
    "Base operating system. Hardening script is tuned for Ubuntu/Debian.",
  );

  // 6. User
  const user = await ask("Login user (non-root)", {
    hint: "A passwordless-sudo user is created with this name. Root login is always disabled.",
    default: DEFAULTS.user,
    validate: (v) => (/^[a-z][a-z0-9_-]*$/.test(v) ? null : "lowercase letters, digits, _ and - only"),
  });

  // 7. SSH port
  const sshPortStr = await ask("Custom SSH port", {
    hint: "Reduces drive-by scan noise; not real security on its own. Default 2137.",
    default: String(DEFAULTS.ssh_port),
    validate: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "1-65535";
    },
  });
  const sshPort = Number(sshPortStr);

  // 8. SSH source restriction
  let myIp = "";
  try {
    myIp = await resolvePublicIPv4();
  } catch {
    console.log("  (could not resolve your public IP — ip.hetzner.com unreachable)");
  }
  const restrictSsh = await confirm(
    myIp
      ? `Restrict SSH to your current IP (${myIp})?`
      : `Restrict SSH to your current IP? (we couldn't resolve it now — choosing 'no' is safer)`,
    !!myIp,
  );

  // 9. HTTP/HTTPS
  const openHttp = await confirm("Open HTTP (80) and HTTPS (443) to the world?", true);

  // 10. Harden
  const harden = await confirm(
    "Run hardening (ufw + fail2ban + unattended-upgrades)?",
    true,
  );

  // 11. Confirmation
  console.log("\n--- Plan ---");
  console.log(`  name:        ${name}`);
  console.log(`  type:        ${type}`);
  console.log(`  location:    ${location}`);
  console.log(`  image:       ${image}`);
  console.log(`  user:        ${user}`);
  console.log(`  ssh port:    ${sshPort}`);
  console.log(`  ssh source:  ${restrictSsh && myIp ? `${myIp}/32 only` : "anywhere"}`);
  console.log(`  http/https:  ${openHttp ? "open to world" : "closed"}`);
  console.log(`  harden:      ${harden ? "yes" : "no"}`);
  console.log("");

  const go = await confirm("Proceed?", true);
  if (!go) {
    console.log("aborted");
    return;
  }

  await create({
    token,
    name,
    type,
    location,
    image,
    user,
    sshPort,
    sshFromAnywhere: !(restrictSsh && myIp),
    noHttp: !openHttp,
    noHarden: !harden,
  });
}
