import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { resolvePublicIPv4 } from "../src/public-ip";

const realFetch = globalThis.fetch;

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
function stubFetch(impl: FetchImpl): void {
  globalThis.fetch = impl as unknown as typeof globalThis.fetch;
}

describe("resolvePublicIPv4", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("returns a plain-text IPv4 body verbatim", async () => {
    stubFetch(async () => new Response("203.0.113.7\n", { status: 200 }));
    expect(await resolvePublicIPv4()).toBe("203.0.113.7");
  });

  test("falls back to scraping window.ipv4 from HTML", async () => {
    const html =
      `<html><head></head><body>` +
      `<script>window.ipv4 = "198.51.100.42"; window.ipv6 = undefined;</script>` +
      `</body></html>`;
    stubFetch(async () => new Response(html, { status: 200 }));
    expect(await resolvePublicIPv4()).toBe("198.51.100.42");
  });

  test("throws on non-2xx", async () => {
    stubFetch(async () => new Response("nope", { status: 503 }));
    await expect(resolvePublicIPv4()).rejects.toThrow(/HTTP 503/);
  });

  test("throws when neither plain text nor HTML scrape yield an IPv4", async () => {
    stubFetch(async () => new Response("<html>no script tag here</html>", { status: 200 }));
    await expect(resolvePublicIPv4()).rejects.toThrow(/Could not parse IPv4/);
  });

  test("sends a curl-style User-Agent so Hetzner returns plain text", async () => {
    let captured = "";
    stubFetch(async (_url, init) => {
      const headers = new Headers(init?.headers);
      captured = headers.get("user-agent") ?? "";
      return new Response("203.0.113.7", { status: 200 });
    });
    await resolvePublicIPv4();
    expect(captured.toLowerCase()).toContain("curl");
  });
});
