const API_BASE = "https://api.hetzner.cloud/v1";

export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: { ip: string } | null;
    ipv6: { ip: string } | null;
  };
  server_type: { name: string };
  datacenter: { location: { name: string } };
  image: { name: string | null; description: string };
  created: string;
}

export interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

export interface HetznerFirewallRule {
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
  port?: string;
  source_ips?: string[];
  destination_ips?: string[];
  description?: string;
}

export interface HetznerFirewall {
  id: number;
  name: string;
  rules: HetznerFirewallRule[];
}

export interface HetznerAction {
  id: number;
  status: "running" | "success" | "error";
  progress: number;
  error?: { code: string; message: string } | null;
}

export class HetznerError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class HetznerClient {
  constructor(private token: string) {
    if (!token) throw new Error("Hetzner token is required");
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // non-JSON body
      }
    }

    if (!res.ok) {
      const err = parsed?.error;
      throw new HetznerError(
        res.status,
        err?.message ?? `Hetzner API ${method} ${path} failed: ${res.status}`,
        err?.code,
        err?.details,
      );
    }

    return parsed as T;
  }

  // SSH keys
  async createSshKey(name: string, publicKey: string): Promise<HetznerSshKey> {
    const r = await this.request<{ ssh_key: HetznerSshKey }>("POST", "/ssh_keys", {
      name,
      public_key: publicKey,
    });
    return r.ssh_key;
  }

  async deleteSshKey(id: number): Promise<void> {
    await this.request("DELETE", `/ssh_keys/${id}`);
  }

  async findSshKeyByName(name: string): Promise<HetznerSshKey | null> {
    const r = await this.request<{ ssh_keys: HetznerSshKey[] }>(
      "GET",
      `/ssh_keys?name=${encodeURIComponent(name)}`,
    );
    return r.ssh_keys[0] ?? null;
  }

  // Firewalls
  async createFirewall(
    name: string,
    rules: HetznerFirewallRule[],
  ): Promise<HetznerFirewall> {
    const r = await this.request<{ firewall: HetznerFirewall }>("POST", "/firewalls", {
      name,
      rules,
    });
    return r.firewall;
  }

  async getFirewall(id: number): Promise<HetznerFirewall> {
    const r = await this.request<{ firewall: HetznerFirewall }>("GET", `/firewalls/${id}`);
    return r.firewall;
  }

  async findFirewallByName(name: string): Promise<HetznerFirewall | null> {
    const r = await this.request<{ firewalls: HetznerFirewall[] }>(
      "GET",
      `/firewalls?name=${encodeURIComponent(name)}`,
    );
    return r.firewalls[0] ?? null;
  }

  async setFirewallRules(id: number, rules: HetznerFirewallRule[]): Promise<void> {
    await this.request("POST", `/firewalls/${id}/actions/set_rules`, { rules });
  }

  async deleteFirewall(id: number): Promise<void> {
    await this.request("DELETE", `/firewalls/${id}`);
  }

  // Servers
  async createServer(payload: {
    name: string;
    server_type: string;
    location: string;
    image: string;
    ssh_keys?: number[];
    firewalls?: { firewall: number }[];
    user_data?: string;
    start_after_create?: boolean;
  }): Promise<{ server: HetznerServer; action: HetznerAction; root_password: string | null }> {
    return await this.request("POST", "/servers", {
      start_after_create: true,
      ...payload,
    });
  }

  async getServer(id: number): Promise<HetznerServer> {
    const r = await this.request<{ server: HetznerServer }>("GET", `/servers/${id}`);
    return r.server;
  }

  async deleteServer(id: number): Promise<{ action: HetznerAction }> {
    return await this.request("DELETE", `/servers/${id}`);
  }

  // Actions
  async getAction(id: number): Promise<HetznerAction> {
    const r = await this.request<{ action: HetznerAction }>("GET", `/actions/${id}`);
    return r.action;
  }

  async waitForAction(id: number, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<HetznerAction> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollMs = opts.pollMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const action = await this.getAction(id);
      if (action.status === "success") return action;
      if (action.status === "error") {
        throw new HetznerError(
          0,
          action.error?.message ?? "Hetzner action failed",
          action.error?.code,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for action ${id} (status=${action.status})`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
