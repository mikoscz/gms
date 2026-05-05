import { test, expect, describe, afterEach } from "bun:test";
import { HetznerClient, HetznerError } from "../src/hetzner";

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: any;
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function recordingFetch(
  responder: (req: RecordedRequest) => Response | Promise<Response>,
): { fn: typeof globalThis.fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn: FetchImpl = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let body: any = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    const req = { url, method, headers, body };
    calls.push(req);
    return await responder(req);
  };
  return { fn: fn as unknown as typeof globalThis.fetch, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("HetznerClient", () => {
  test("rejects construction without a token", () => {
    expect(() => new HetznerClient("")).toThrow();
  });

  test("createSshKey POSTs the right payload and returns the unwrapped object", async () => {
    const { fn, calls } = recordingFetch(() =>
      json(201, { ssh_key: { id: 42, name: "gms-x", fingerprint: "fp", public_key: "pk" } }),
    );
    globalThis.fetch = fn;

    const c = new HetznerClient("tok");
    const key = await c.createSshKey("gms-x", "ssh-ed25519 AAA");

    expect(key).toEqual({ id: 42, name: "gms-x", fingerprint: "fp", public_key: "pk" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.hetzner.cloud/v1/ssh_keys");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer tok");
    expect(calls[0]!.body).toEqual({ name: "gms-x", public_key: "ssh-ed25519 AAA" });
  });

  test("getServer GETs and unwraps", async () => {
    const { fn } = recordingFetch(() =>
      json(200, {
        server: {
          id: 1,
          name: "x",
          status: "running",
          public_net: { ipv4: { ip: "1.2.3.4" }, ipv6: null },
          server_type: { name: "cx23" },
          datacenter: { location: { name: "fsn1" } },
          image: { name: "ubuntu-24.04", description: "Ubuntu 24.04" },
          created: "2026-01-01T00:00:00Z",
        },
      }),
    );
    globalThis.fetch = fn;

    const s = await new HetznerClient("tok").getServer(1);
    expect(s.id).toBe(1);
    expect(s.public_net.ipv4?.ip).toBe("1.2.3.4");
  });

  test("204 responses don't try to JSON-parse", async () => {
    const { fn, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    globalThis.fetch = fn;

    await new HetznerClient("tok").deleteSshKey(7);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://api.hetzner.cloud/v1/ssh_keys/7");
  });

  test("non-2xx responses become HetznerError carrying status, code, and message", async () => {
    const { fn } = recordingFetch(() =>
      json(404, { error: { code: "not_found", message: "server not found" } }),
    );
    globalThis.fetch = fn;

    try {
      await new HetznerClient("tok").getServer(999);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HetznerError);
      const err = e as HetznerError;
      expect(err.status).toBe(404);
      expect(err.code).toBe("not_found");
      expect(err.message).toBe("server not found");
    }
  });

  test("findFirewallByName returns null when none match", async () => {
    const { fn } = recordingFetch(() => json(200, { firewalls: [] }));
    globalThis.fetch = fn;
    expect(await new HetznerClient("tok").findFirewallByName("no-such")).toBeNull();
  });

  test("findFirewallByName URL-encodes the name", async () => {
    const { fn, calls } = recordingFetch(() => json(200, { firewalls: [] }));
    globalThis.fetch = fn;
    await new HetznerClient("tok").findFirewallByName("a b/c");
    expect(calls[0]!.url).toBe("https://api.hetzner.cloud/v1/firewalls?name=a%20b%2Fc");
  });

  test("waitForAction polls until success", async () => {
    let n = 0;
    const { fn } = recordingFetch(() => {
      n++;
      if (n < 3) return json(200, { action: { id: 1, status: "running", progress: 50 } });
      return json(200, { action: { id: 1, status: "success", progress: 100 } });
    });
    globalThis.fetch = fn;

    const action = await new HetznerClient("tok").waitForAction(1, { pollMs: 1, timeoutMs: 5000 });
    expect(action.status).toBe("success");
    expect(n).toBe(3);
  });

  test("waitForAction throws on action error with the API-reported message", async () => {
    const { fn } = recordingFetch(() =>
      json(200, {
        action: {
          id: 1,
          status: "error",
          progress: 0,
          error: { code: "foo", message: "boom" },
        },
      }),
    );
    globalThis.fetch = fn;
    await expect(
      new HetznerClient("tok").waitForAction(1, { pollMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(/boom/);
  });

  test("waitForAction times out", async () => {
    const { fn } = recordingFetch(() =>
      json(200, { action: { id: 1, status: "running", progress: 10 } }),
    );
    globalThis.fetch = fn;
    await expect(
      new HetznerClient("tok").waitForAction(1, { pollMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/Timed out/);
  });

  test("createServer defaults start_after_create to true", async () => {
    const { fn, calls } = recordingFetch(() =>
      json(201, {
        server: {
          id: 1,
          name: "x",
          status: "initializing",
          public_net: { ipv4: { ip: "1.2.3.4" }, ipv6: null },
          server_type: { name: "cx23" },
          datacenter: { location: { name: "fsn1" } },
          image: { name: "ubuntu-24.04", description: "Ubuntu 24.04" },
          created: "2026-01-01T00:00:00Z",
        },
        action: { id: 99, status: "running", progress: 0 },
        root_password: null,
      }),
    );
    globalThis.fetch = fn;

    await new HetznerClient("tok").createServer({
      name: "x",
      server_type: "cx23",
      location: "fsn1",
      image: "ubuntu-24.04",
    });

    expect(calls[0]!.body.start_after_create).toBe(true);
  });
});
