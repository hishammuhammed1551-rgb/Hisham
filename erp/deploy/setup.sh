#!/usr/bin/env bash
# Lowcaps ERP — one-time server setup for Oracle Cloud (Ubuntu 22.04 or 24.04).
#
# Copy this file to the server and run:  sudo bash setup.sh
# Step-by-step guide: erp/deploy/ORACLE-CLOUD.md
#
# Optional settings (put them before the command, e.g. sudo DOMAIN=erp.lowcaps.ae bash setup.sh):
#   DOMAIN    web address for the ERP, e.g. erp.lowcaps.ae (asked for if not set)
#   REPO_URL  git URL of the repository (default: this project's GitHub repo over SSH)
#   BRANCH    branch to run (default: the branch the ERP was built on)
#
# Safe to run again: it updates what is already there.

set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:hishammuhammed1551-rgb/Hisham.git}"
BRANCH="${BRANCH:-claude/hopeful-noether-8z68ea}"   # branch that holds the ERP
DOMAIN="${DOMAIN:-}"
APP_DIR=/opt/lowcaps-erp
DATA_DIR=/var/lib/lowcaps-erp
BACKUP_DIR=/var/backups/lowcaps-erp
SERVICE_USER=lowcaps
DEPLOY_KEY=/root/.ssh/lowcaps_erp_deploy

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this with sudo:  sudo bash $0"
grep -qi ubuntu /etc/os-release || die "this script is written for Ubuntu (pick an Ubuntu image when creating the server)"

# ---------------------------------------------------------------- packages
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git sqlite3 curl ca-certificates gnupg caddy iptables-persistent netfilter-persistent
timedatectl set-timezone Asia/Dubai || true

node_ok() {
  command -v node >/dev/null &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)'
}
if ! node_ok; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node_ok || die "Node.js 22.5 or newer is required, found $(node --version 2>/dev/null || echo none)"
echo "Node.js $(node --version)"

# ---------------------------------------------------------------- code
if [[ $REPO_URL == git@* ]]; then
  if [[ ! -f $DEPLOY_KEY ]]; then
    say "Creating a read-only GitHub deploy key for this server"
    mkdir -p /root/.ssh && chmod 700 /root/.ssh
    ssh-keygen -t ed25519 -N '' -C "lowcaps-erp-server" -f "$DEPLOY_KEY" >/dev/null
  fi
  if ! grep -q "$DEPLOY_KEY" /root/.ssh/config 2>/dev/null; then
    cat >> /root/.ssh/config <<EOF

Host github.com
  IdentityFile $DEPLOY_KEY
  IdentitiesOnly yes
EOF
    chmod 600 /root/.ssh/config
  fi
  ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
  sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts

  until ssh -o BatchMode=yes -T git@github.com 2>&1 | grep -q "successfully authenticated"; do
    echo
    warn "GitHub doesn't accept this server's key yet. Add it as a deploy key:"
    echo "  1. Open your repository on GitHub > Settings > Deploy keys > Add deploy key"
    echo "  2. Title: Oracle ERP server   (leave 'Allow write access' unticked)"
    echo "  3. Paste this key:"
    echo
    cat "$DEPLOY_KEY.pub"
    echo
    read -rp "Press Enter once you have added it (Ctrl+C to stop)... " _
  done
  echo "GitHub access OK"
fi

say "Getting the ERP code (branch: $BRANCH)"
if [[ -d $APP_DIR/.git ]]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet -B "$BRANCH" FETCH_HEAD
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
[[ -f $APP_DIR/erp/server.js ]] || die "branch '$BRANCH' has no erp/ folder. Merge the ERP into it, or rerun with BRANCH=<branch with the ERP>"

say "Running the ERP's tests"
(cd "$APP_DIR/erp" && node --disable-warning=ExperimentalWarning --test test/*.test.js >/tmp/lowcaps-tests.log 2>&1) \
  || { tail -30 /tmp/lowcaps-tests.log; die "tests failed; not starting the ERP"; }
echo "All tests passed"

# ---------------------------------------------------------------- app service
say "Setting up the ERP service"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_DIR"
install -d -o root -g root -m 700 "$BACKUP_DIR"

cat > /etc/systemd/system/lowcaps-erp.service <<EOF
[Unit]
Description=Lowcaps ERP
After=network.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$APP_DIR/erp
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DB_FILE=$DATA_DIR/lowcaps.db
Environment=TZ_BUSINESS=Asia/Dubai
Environment=COOKIE_SECURE=true
Environment=TRUST_PROXY=true
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

# ---------------------------------------------------------------- web address + HTTPS
if [[ -z $DOMAIN && -f /etc/caddy/lowcaps-domain ]]; then
  DOMAIN=$(cat /etc/caddy/lowcaps-domain)
fi
if [[ -z $DOMAIN ]]; then
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || true)
  echo
  echo "Which web address should the ERP use? For example: erp.lowcaps.ae"
  echo "(Its DNS 'A' record must already point to this server's public IP${PUBLIC_IP:+: $PUBLIC_IP}.)"
  if [[ -n $PUBLIC_IP ]]; then
    echo "No domain yet? Press Enter to use a free temporary address: ${PUBLIC_IP//./-}.sslip.io"
  fi
  read -rp "Web address: " DOMAIN
  if [[ -z $DOMAIN ]]; then
    [[ -n $PUBLIC_IP ]] || die "couldn't detect the public IP; rerun with DOMAIN=<your address>"
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  fi
fi
DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "'$DOMAIN' doesn't look like a web address"
echo "$DOMAIN" > /etc/caddy/lowcaps-domain

say "Configuring HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
# Lowcaps ERP — managed by erp/deploy/setup.sh
$DOMAIN {
	encode gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

# Oracle's Ubuntu images block incoming traffic with iptables apart from SSH. Open 80 and 443.
say "Opening ports 80 and 443 in the server firewall"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    reject_line=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    if [[ -n $reject_line ]]; then
      iptables -I INPUT "$reject_line" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
netfilter-persistent save >/dev/null

# ---------------------------------------------------------------- backups
say "Scheduling nightly backups (kept for 30 days in $BACKUP_DIR)"
cat > /usr/local/bin/lowcaps-erp-backup <<EOF
#!/usr/bin/env bash
# Safe online backup of the ERP database; keeps 30 days.
set -euo pipefail
[[ -f $DATA_DIR/lowcaps.db ]] || exit 0
file=$BACKUP_DIR/lowcaps-\$(date +%Y-%m-%d_%H%M).db
sqlite3 $DATA_DIR/lowcaps.db ".backup '\$file'"
gzip -f "\$file"
find $BACKUP_DIR -name 'lowcaps-*.db.gz' -mtime +30 -delete
EOF
chmod 755 /usr/local/bin/lowcaps-erp-backup

cat > /etc/systemd/system/lowcaps-erp-backup.service <<EOF
[Unit]
Description=Back up the Lowcaps ERP database

[Service]
Type=oneshot
ExecStart=/usr/local/bin/lowcaps-erp-backup
EOF

cat > /etc/systemd/system/lowcaps-erp-backup.timer <<EOF
[Unit]
Description=Nightly Lowcaps ERP backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

# ---------------------------------------------------------------- start
say "Starting everything"
systemctl daemon-reload
systemctl enable --now lowcaps-erp.service lowcaps-erp-backup.timer >/dev/null
systemctl restart lowcaps-erp.service
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

for _ in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3000/api/setup >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/setup >/dev/null || {
  journalctl -u lowcaps-erp -n 30 --no-pager
  die "the ERP didn't start; see the log above"
}

say "Done!"
echo "Open:  https://$DOMAIN"
echo
echo "The first person to open it creates the administrator account, so do that now."
echo "The HTTPS certificate can take a minute on first visit. If it fails, check that"
echo "ports 80 and 443 are open in Oracle's Security List (see erp/deploy/ORACLE-CLOUD.md)."
echo
echo "Useful commands:"
echo "  sudo bash $APP_DIR/erp/deploy/update.sh        # install the latest version from GitHub"
echo "  sudo journalctl -u lowcaps-erp -f              # live log"
echo "  sudo /usr/local/bin/lowcaps-erp-backup         # back up now"
