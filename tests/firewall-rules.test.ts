import { test, expect, describe } from "bun:test";
import { addIpToSshRule, looksLikeIp } from "../src/commands/firewall";
import type { HetznerFirewallRule } from "../src/hetzner";

describe("looksLikeIp", () => {
  test("accepts plain IPv4 and IPv4/CIDR", () => {
    expect(looksLikeIp("1.2.3.4")).toBe(true);
    expect(looksLikeIp("203.0.113.7/32")).toBe(true);
  });

  test("rejects junk", () => {
    expect(looksLikeIp("me")).toBe(false);
    expect(looksLikeIp("not-an-ip")).toBe(false);
    expect(looksLikeIp("::1")).toBe(false);
    expect(looksLikeIp("")).toBe(false);
  });
});

describe("addIpToSshRule", () => {
  const httpsRule: HetznerFirewallRule = {
    direction: "in",
    protocol: "tcp",
    port: "443",
    source_ips: ["0.0.0.0/0", "::/0"],
    description: "gms-https",
  };

  test("appends a new SSH rule when none exists", () => {
    const result = addIpToSshRule([httpsRule], 2137, "1.2.3.4/32");
    expect(result).toHaveLength(2);
    const ssh = result.find((r) => r.port === "2137")!;
    expect(ssh.source_ips).toEqual(["1.2.3.4/32"]);
    expect(ssh.description).toBe("gms-ssh");
    expect(ssh.direction).toBe("in");
    expect(ssh.protocol).toBe("tcp");
  });

  test("appends to existing SSH rule's source_ips", () => {
    const sshRule: HetznerFirewallRule = {
      direction: "in",
      protocol: "tcp",
      port: "2137",
      source_ips: ["10.0.0.0/32"],
      description: "gms-ssh",
    };
    const result = addIpToSshRule([sshRule, httpsRule], 2137, "1.2.3.4/32");
    expect(result).toHaveLength(2);
    const ssh = result.find((r) => r.port === "2137")!;
    expect(ssh.source_ips).toEqual(expect.arrayContaining(["10.0.0.0/32", "1.2.3.4/32"]));
    expect(ssh.source_ips).toHaveLength(2);
  });

  test("dedupes when the IP is already allowed", () => {
    const sshRule: HetznerFirewallRule = {
      direction: "in",
      protocol: "tcp",
      port: "2137",
      source_ips: ["1.2.3.4/32"],
      description: "gms-ssh",
    };
    const result = addIpToSshRule([sshRule], 2137, "1.2.3.4/32");
    expect(result[0]!.source_ips).toEqual(["1.2.3.4/32"]);
  });

  test("only matches the rule on the configured SSH port", () => {
    const otherSshLikeRule: HetznerFirewallRule = {
      direction: "in",
      protocol: "tcp",
      port: "22", // legacy
      source_ips: ["0.0.0.0/0"],
      description: "legacy-ssh",
    };
    const result = addIpToSshRule([otherSshLikeRule], 2137, "1.2.3.4/32");
    expect(result).toHaveLength(2);
    expect(result[0]!.port).toBe("22");
    expect(result[0]!.source_ips).toEqual(["0.0.0.0/0"]);
    expect(result[1]!.port).toBe("2137");
  });

  test("does not mutate the input rules", () => {
    const sshRule: HetznerFirewallRule = {
      direction: "in",
      protocol: "tcp",
      port: "2137",
      source_ips: ["10.0.0.0/32"],
      description: "gms-ssh",
    };
    const original = JSON.parse(JSON.stringify(sshRule));
    addIpToSshRule([sshRule], 2137, "1.2.3.4/32");
    expect(sshRule).toEqual(original);
  });
});
