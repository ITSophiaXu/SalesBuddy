#!/usr/bin/env bash
# Prepare an isolated Linux VM deployment. Does not start services or alter NSGs.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ -e .deploy.env ]]; then
  printf 'Existing .deploy.env preserved. Review DEPLOYMENT.md for upgrade instructions.\n'
  exit 0
fi
origin="${1:-http://127.0.0.1:4173}"
if [[ "$origin" != 'http://127.0.0.1:4173' && ! "$origin" =~ ^https://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  printf 'Use the loopback origin or an HTTPS DNS hostname without a path.\n' >&2
  exit 1
fi
command -v docker >/dev/null
command -v openssl >/dev/null
docker compose version >/dev/null
docker info >/dev/null
# Resolve registry versions before creating any configuration. Network failures stop here.
sdk_version="$(docker run --rm node:22-bookworm-slim npm view @github/copilot-sdk version --loglevel=error)"
cli_version="$(docker run --rm node:22-bookworm-slim npm view @github/copilot version --loglevel=error)"
for version in "$sdk_version" "$cli_version"; do
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || { printf 'Registry returned an invalid version.\n' >&2; exit 1; }
done
umask 077
mkdir -p .private
chmod 700 .private
if [[ ! -f .private/workspace-password ]]; then
  openssl rand -hex 32 > .private/workspace-password
  # The containing directory is private; the container mounts only this file.
  chmod 444 .private/workspace-password
fi
domain=''
if [[ "$origin" == https://* ]]; then domain="${origin#https://}"; fi
cat > .deploy.env <<EOF
MOTIVE_RELEASE=$(date -u +%Y%m%dT%H%M%SZ)
COPILOT_SDK_VERSION=$sdk_version
COPILOT_CLI_VERSION=$cli_version
COPILOT_MODEL=
PUBLIC_ORIGIN=$origin
MOTIVE_DOMAIN=$domain
EOF
printf 'Prepared deployment configuration and private login file. No services were started.\n'
printf 'Next: docker compose --env-file .deploy.env build\n'
printf 'Then complete Copilot login and the real generation check in DEPLOYMENT.md.\n'
