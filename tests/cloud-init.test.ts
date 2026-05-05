import { test, expect, describe } from "bun:test";
import { renderCloudInit } from "../src/cloud-init";

function parsePayload(s: string): { header: string; config: any } {
  const lines = s.split("\n");
  const header = lines[0]!;
  const body = lines.slice(1).join("\n");
  return { header, config: JSON.parse(body) };
}

describe("renderCloudInit", () => {
  const base = {
    user: "app",
    publicKey: "ssh-ed25519 AAAA…test test@gms",
    sshPort: 2137,
    harden: true,
  };

  test("starts with the #cloud-config header", () => {
    expect(renderCloudInit(base).startsWith("#cloud-config\n")).toBe(true);
  });

  test("body is valid JSON", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config).toBeObject();
  });

  test("disables root and password auth", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config.disable_root).toBe(true);
    expect(config.ssh_pwauth).toBe(false);
  });

  test("requests apt update + upgrade and installs hardening packages", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config.package_update).toBe(true);
    expect(config.package_upgrade).toBe(true);
    expect(config.packages).toEqual(["ufw", "fail2ban", "unattended-upgrades"]);
  });

  test("creates the user with passwordless sudo and the provided pubkey", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config.users).toHaveLength(1);
    const u = config.users[0];
    expect(u.name).toBe("app");
    expect(u.sudo).toEqual(["ALL=(ALL) NOPASSWD:ALL"]);
    expect(u.shell).toBe("/bin/bash");
    expect(u.ssh_authorized_keys).toEqual([base.publicKey]);
  });

  test("sshd drop-in pins the custom port and disables root/password auth", () => {
    const { config } = parsePayload(renderCloudInit(base));
    const sshd = config.write_files.find(
      (f: any) => f.path === "/etc/ssh/sshd_config.d/99-gms.conf",
    );
    expect(sshd).toBeTruthy();
    expect(sshd.permissions).toBe("0644");
    expect(sshd.content).toContain("Port 2137");
    expect(sshd.content).toContain("PermitRootLogin no");
    expect(sshd.content).toContain("PasswordAuthentication no");
    expect(sshd.content).toContain("PubkeyAuthentication yes");
  });

  test("embeds the harden script as a write_files entry", () => {
    const { config } = parsePayload(renderCloudInit(base));
    const harden = config.write_files.find(
      (f: any) => f.path === "/usr/local/sbin/gms-harden.sh",
    );
    expect(harden).toBeTruthy();
    expect(harden.permissions).toBe("0755");
    expect(harden.content).toContain("#!/usr/bin/env bash");
    expect(harden.content).toContain("ufw --force enable");
    expect(harden.content).toContain("fail2ban");
  });

  test("runcmd restarts sshd and runs the harden script with the right port", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config.runcmd[0]).toEqual(["systemctl", "restart", "ssh"]);
    expect(config.runcmd[1]).toEqual([
      "bash",
      "/usr/local/sbin/gms-harden.sh",
      "--ssh-port",
      "2137",
    ]);
  });

  test("with harden:false, runcmd skips the harden invocation but still restarts sshd", () => {
    const { config } = parsePayload(renderCloudInit({ ...base, harden: false }));
    expect(config.runcmd).toHaveLength(1);
    expect(config.runcmd[0]).toEqual(["systemctl", "restart", "ssh"]);
  });

  test("custom ssh port flows into both sshd config and harden invocation", () => {
    const { config } = parsePayload(renderCloudInit({ ...base, sshPort: 9999 }));
    const sshd = config.write_files.find(
      (f: any) => f.path === "/etc/ssh/sshd_config.d/99-gms.conf",
    );
    expect(sshd.content).toContain("Port 9999");
    expect(config.runcmd[1]).toEqual([
      "bash",
      "/usr/local/sbin/gms-harden.sh",
      "--ssh-port",
      "9999",
    ]);
  });

  test("reboots if upgrades require it", () => {
    const { config } = parsePayload(renderCloudInit(base));
    expect(config.power_state.mode).toBe("reboot");
    expect(config.power_state.condition).toContain("reboot-required");
  });
});
