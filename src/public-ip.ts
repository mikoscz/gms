const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export async function resolvePublicIPv4(): Promise<string> {
  // ip.hetzner.com serves plain text only when the User-Agent looks like curl;
  // browsers (and bare fetch) get an HTML page that embeds `window.ipv4 = "..."`.
  const res = await fetch("https://ip.hetzner.com", {
    headers: { "User-Agent": "curl/8.0 gms-hetzner-cli" },
  });
  if (!res.ok) {
    throw new Error(`ip.hetzner.com returned HTTP ${res.status}`);
  }
  const body = (await res.text()).trim();
  if (IPV4_RE.test(body)) return body;

  // Fallback: extract from HTML if Hetzner ever changes UA detection
  const m = body.match(/window\.ipv4\s*=\s*"(\d{1,3}(?:\.\d{1,3}){3})"/);
  if (m && m[1]) return m[1];

  throw new Error(`Could not parse IPv4 from ip.hetzner.com response`);
}
