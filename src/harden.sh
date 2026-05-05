#!/usr/bin/env bash
# gms server hardening — idempotent. Invoked by cloud-init on first boot.
# sshd_config drop-in is owned by /etc/ssh/sshd_config.d/99-gms.conf.

set -euo pipefail

SSH_PORT=22
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port)
      SSH_PORT="$2"; shift 2;;
    *)
      echo "gms-harden: unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "gms-harden: must run as root" >&2
  exit 1
fi

log() { echo "[gms-harden] $*"; }

export DEBIAN_FRONTEND=noninteractive

log "ensuring ufw / fail2ban / unattended-upgrades are installed"
if ! command -v ufw >/dev/null 2>&1 || \
   ! command -v fail2ban-server >/dev/null 2>&1 || \
   ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ufw fail2ban unattended-upgrades
fi

log "configuring ufw (ssh on ${SSH_PORT}/tcp, http 80, https 443)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'gms-ssh'
ufw allow 80/tcp comment 'gms-http'
ufw allow 443/tcp comment 'gms-https'
ufw --force enable

log "configuring fail2ban for sshd on port ${SSH_PORT}"
mkdir -p /etc/fail2ban/jail.d
cat >/etc/fail2ban/jail.d/gms-ssh.local <<EOF
[sshd]
enabled = true
port    = ${SSH_PORT}
backend = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban

log "configuring unattended-upgrades for daily security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

log "done"
