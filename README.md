# gms — Give Me Server

A small CLI that provisions and hardens a Hetzner Cloud server for a project, then lets you `gms connect` from inside the repo whenever you need a shell.

Built on top of the Hetzner Cloud API and designed around a per-project workflow:

- Generates a fresh `ed25519` keypair per server (no shared keys across projects)
- Creates a firewall that only opens SSH to your current public IP by default
- Moves SSH off port 22 (default `2137`) and disables root + password auth
- Runs `apt update && apt upgrade` on first boot, then installs `ufw` + `fail2ban` + `unattended-upgrades`
- Writes a `.gms.json` into the project so `gms connect` just works from anywhere in the repo
- Compiles to a single self-contained binary

---

## Install

The easiest way is to grab a pre-built binary (see [Build from source](#build-from-source) for now — releases are TBD):

```bash
# Build, then move it onto your PATH
bun install
bun run build
mv dist/gms /usr/local/bin/gms
```

Requires `ssh-keygen` and `ssh` on your machine (both ship with macOS and most Linux distros).

---

## Usage

### First-time setup (interactive)

`gms setup` walks you through every option with a one-line explanation. Recommended for a first try.

```bash
cd ~/code/my-project
export HCLOUD_TOKEN=...        # see "Get a Hetzner token" below
gms setup
```

It will ask for the token, server name (defaults to the repo basename), instance type, location, OS image, login user, SSH port, whether to restrict SSH to your IP, and whether to harden the box. At the end it prints the full plan and asks for confirmation.

### Provision with flags (non-interactive)

```bash
gms create                          # uses all defaults, name = repo basename
gms create --name api --type cx32   # 4 vCPU / 8 GB
gms create --ssh-from-anywhere      # don't restrict SSH to your current IP
gms create --no-harden --dry-run    # preview the API calls + cloud-init payload
```

#### Defaults

| Flag           | Default          | Notes                                                             |
| -------------- | ---------------- | ----------------------------------------------------------------- |
| `--name`       | repo basename    | Used as the Hetzner server name and the local key filename        |
| `--type`       | `cx23`           | 2 vCPU / 4 GB, ~€4/mo                                             |
| `--location`   | `fsn1`           | Falkenstein, DE                                                   |
| `--image`      | `ubuntu-24.04`   |                                                                   |
| `--user`       | `app`            | Created with passwordless sudo; root login is always disabled     |
| `--ssh-port`   | `2137`           | sshd is configured for this port from first boot                  |
| firewall       | auto-created     | SSH from your IP only, HTTP/HTTPS open. `--firewall <id>` to reuse |
| harden         | on               | `--no-harden` to skip                                             |

Run `gms create --help` for the full list (`--firewall-port`, `--no-http`, `--pubkey`, `--keep-keys`, etc.).

### Connect from inside the project

```bash
cd ~/code/my-project
gms connect
```

`gms connect` walks up from your cwd looking for `.gms.json`. If it doesn't find one, it falls back to the global registry keyed by the repo basename. You can also pass an explicit name: `gms connect api`.

### Other commands

```bash
gms list                          # tabular view of every server gms manages on this machine
gms status [name]                 # live state from Hetzner (status, IPs, datacenter)
gms firewall allow [name] [ip|me] # add an IP to the SSH rule (e.g. after your home IP changed)
gms destroy [name] --yes          # delete server + auto-created firewall + SSH key + local keypair
```

### State on disk

| Path                                  | What it stores                                                |
| ------------------------------------- | ------------------------------------------------------------- |
| `~/.config/gms/keys/<name>`           | Generated private key (`0600`)                                |
| `~/.config/gms/keys/<name>.pub`       | Generated public key                                          |
| `~/.config/gms/servers.json`          | Global registry of every server `gms` knows about             |
| `<repo>/.gms.json`                    | Per-project metadata (server id, IP, port, key path, etc.)    |

`.gms.json` doesn't contain any secrets — only Hetzner IDs, the public IP, and a path to the local key. Whether you commit it or add it to `.gitignore` is up to you.

---

## Get a Hetzner token

1. Sign in to [console.hetzner.cloud](https://console.hetzner.cloud).
2. Pick (or create) a **Project**. Tokens are scoped to a single project — `gms` will create servers, firewalls, and SSH keys inside whichever project the token belongs to.
3. In the project sidebar, open **Security** → **API Tokens** → **Generate API Token**.
4. Give it a name (e.g. `gms`) and select **Read & Write** permissions. Click **Generate**.
5. **Copy the token immediately** — Hetzner only shows it once.

Then either pass it explicitly:

```bash
gms create --token hcloud_pat_xxxxxxxxxxxx
```

or export it (recommended — `gms` reads it automatically):

```bash
export HCLOUD_TOKEN=hcloud_pat_xxxxxxxxxxxx
```

If you manage multiple Hetzner projects, keep one token per project and `export` the right one before running `gms`.

---

## Build from source

Requires [Bun](https://bun.sh) ≥ 1.3 (uses `bun build --compile` for the single-binary output).

```bash
git clone <this repo>
cd gms-hetzner
bun install
```

Run directly from source while iterating:

```bash
bun run dev create --dry-run --name testproj
# or:
bun run src/index.ts --help
```

Compile a self-contained binary for your current platform:

```bash
bun run build
# → ./dist/gms  (~58 MB, no Bun/Node required at runtime)
./dist/gms --help
```

Cross-compile for other platforms:

```bash
bun run build:darwin-arm64    # → dist/gms-darwin-arm64
bun run build:linux-x64       # → dist/gms-linux-x64
```

The `harden.sh` script is embedded into the binary at build time via `import harden from "./harden.sh" with { type: "text" }`, so the resulting binary has no external file dependencies.

---

## How the SSH-port change avoids lockout

Changing the SSH port is usually risky because of the chicken-and-egg between firewall rules and `sshd` reloading. `gms` sidesteps the race entirely:

1. Hetzner injects your generated public key into root's `authorized_keys` via the cloud metadata service — **no SSH session is needed for that**.
2. The auto-created firewall opens **only** the custom port (`2137` by default), not `22`.
3. Cloud-init writes `/etc/ssh/sshd_config.d/99-gms.conf` with `Port 2137` and restarts `sshd` *before anyone tries to connect*.
4. By the time the server is reachable, `sshd` is already on the new port and the firewall already permits it.

If your home/office IP changes and you can't SSH in, run `gms firewall allow me` from anywhere — it resolves your new public IP via `ip.hetzner.com` and adds it to the firewall's SSH allowlist via the API. As long as you still have the token, you can always recover.

---

## Acknowledgements

Inspired by [`devpush-hetzner`](https://github.com/hunvreus/devpush-hetzner) — a minimal Python provisioner that gave the original sketch for the cloud-init shape and the hardening script.
