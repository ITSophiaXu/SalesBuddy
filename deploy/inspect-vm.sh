#!/usr/bin/env bash
set -eu
uname -srm
cat /etc/os-release
id
df -h / /home
for program in node npm docker copilot nginx caddy; do
  command -v "$program" || true
done
if command -v node >/dev/null; then node --version; fi
if command -v docker >/dev/null; then
  docker --version
  docker compose version || true
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' || true
fi
ss -ltn
systemctl is-active nginx caddy motive 2>/dev/null || true
if [ -d "$HOME/.copilot" ]; then printf 'Copilot home exists for the SSH user.\n'; fi
if [ -d "$HOME/motive" ]; then printf 'Existing ~/motive deployment directory found.\n'; fi
