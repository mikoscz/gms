import hardenScript from "./harden.sh" with { type: "text" };

export interface CloudInitOptions {
  user: string;
  publicKey: string;
  sshPort: number;
  harden: boolean;
}

export function renderCloudInit(opts: CloudInitOptions): string {
  const { user, publicKey, sshPort, harden } = opts;

  const sshdConfig = [
    "# Managed by gms — do not edit by hand",
    `Port ${sshPort}`,
    "PermitRootLogin no",
    "PasswordAuthentication no",
    "PubkeyAuthentication yes",
    "ChallengeResponseAuthentication no",
    "KbdInteractiveAuthentication no",
    "",
  ].join("\n");

  const config: Record<string, unknown> = {
    disable_root: true,
    ssh_pwauth: false,
    package_update: true,
    package_upgrade: true,
    packages: ["ufw", "fail2ban", "unattended-upgrades"],
    users: [
      {
        name: user,
        groups: ["sudo"],
        sudo: ["ALL=(ALL) NOPASSWD:ALL"],
        shell: "/bin/bash",
        ssh_authorized_keys: [publicKey],
      },
    ],
    write_files: [
      {
        path: "/etc/ssh/sshd_config.d/99-gms.conf",
        permissions: "0644",
        owner: "root:root",
        content: sshdConfig,
      },
      {
        path: "/usr/local/sbin/gms-harden.sh",
        permissions: "0755",
        owner: "root:root",
        content: hardenScript,
      },
    ],
    runcmd: [
      ["systemctl", "restart", "ssh"],
      ...(harden ? [["bash", "/usr/local/sbin/gms-harden.sh", "--ssh-port", String(sshPort)]] : []),
    ],
    power_state: {
      mode: "reboot",
      condition: "test -f /var/run/reboot-required",
      message: "gms: rebooting after kernel/security upgrades",
      delay: "+1",
    },
  };

  return `#cloud-config\n${JSON.stringify(config, null, 2)}\n`;
}
