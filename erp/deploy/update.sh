#!/usr/bin/env bash
# Lowcaps ERP — install the latest version from GitHub.
# Run on the server:  sudo bash /opt/lowcaps-erp/erp/deploy/update.sh
# Backs up the database, pulls the code, runs the tests, and only restarts if they pass.

set -euo pipefail
APP_DIR=/opt/lowcaps-erp
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run this with sudo"

branch=$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)
before=$(git -C "$APP_DIR" rev-parse --short HEAD)

echo "==> Backing up the database first"
/usr/local/bin/lowcaps-erp-backup

echo "==> Fetching the latest '$branch' from GitHub"
git -C "$APP_DIR" fetch --quiet origin "$branch"
git -C "$APP_DIR" checkout --quiet -B "$branch" FETCH_HEAD
after=$(git -C "$APP_DIR" rev-parse --short HEAD)

echo "==> Running tests"
if ! (cd "$APP_DIR/erp" && node --disable-warning=ExperimentalWarning --test test/*.test.js >/tmp/lowcaps-tests.log 2>&1); then
  tail -30 /tmp/lowcaps-tests.log
  git -C "$APP_DIR" checkout --quiet -B "$branch" "$before"
  die "tests failed on $after; went back to $before. The running ERP was not touched."
fi

echo "==> Restarting the ERP ($before -> $after)"
systemctl restart lowcaps-erp
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/setup >/dev/null 2>&1; then
    echo "Updated and running."
    exit 0
  fi
  sleep 1
done
journalctl -u lowcaps-erp -n 30 --no-pager
die "the ERP didn't come back up; see the log above"
