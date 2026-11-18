# Putting Lowcaps ERP on Oracle Cloud (free)

This guide puts the ERP online at an address like `https://erp.lowcaps.ae`, on Oracle Cloud's **Always Free** server, in a UAE data centre. Expect about 30–45 minutes the first time. You only need a web browser and the terminal that comes with Windows or Mac.

Steps 1–5 are clicks in Oracle's website. In steps 6–7 you paste a few commands, and the setup script does the rest: installs everything, sets up HTTPS, starts the ERP and schedules nightly backups.

> Oracle changes its screens and free-tier rules from time to time. If a button has a slightly different name, look for the closest match, and check Oracle's current Always Free terms.

---

## Before you start: two things to know

1. **The home region is permanent.** When you sign up you pick a "home region", and Always Free servers can only be created there. Pick **UAE East (Dubai)** or **UAE Central (Abu Dhabi)** to keep customer data in the UAE.
2. **Oracle can reclaim idle free servers.** Oracle's policy says free servers that sit almost idle for 7 days may be stopped. A small ERP uses very little CPU, so this can happen. The fix is to **upgrade the account to "Pay As You Go"** (Billing → Upgrade). You still pay **nothing** as long as you only use Always Free resources, but idle servers are no longer reclaimed. A card is already on file from sign-up. Set a budget alert (Billing → Budgets, e.g. $1) so you're told if anything ever costs money.

---

## 1. Create the Oracle Cloud account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Fill in your details. Choose **Home Region: UAE East (Dubai)** or **UAE Central (Abu Dhabi)**.
3. Verify with a card. Oracle says this is identity verification only.
4. Wait for the "account ready" email (usually minutes, sometimes longer), then sign in.

## 2. Create the server

1. Menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name:** `lowcaps-erp`.
3. **Image and shape** → **Edit**:
   - **Image:** Change image → **Canonical Ubuntu** → **24.04** (22.04 also works).
   - **Shape:** Change shape → **Ampere** → `VM.Standard.A1.Flex`, **1 OCPU and 6 GB memory**. It should say "Always Free-eligible".
   - If you get **"Out of capacity"**, try another *Availability domain* on the same page, try again later, or choose **Specialty and previous generation** → `VM.Standard.E2.1.Micro` (AMD, also Always Free; smaller but enough for this ERP).
4. **Networking:** keep "Create new virtual cloud network" and "Create new public subnet". Make sure **Assign a public IPv4 address** is on.
5. **Add SSH keys:** choose **Generate a key pair for me** and click **Save private key**. Keep this file safe: it's the only way into the server.
6. Click **Create**. When the status is **Running**, copy the **Public IP address** (e.g. `141.147.x.x`).

## 3. Open the web ports in Oracle's network

Oracle blocks web traffic by default. Allow it:

1. On the instance page, click the **subnet** link (under *Primary VNIC*).
2. Open **Security Lists** → **Default Security List for …**.
3. **Add Ingress Rules**, twice:

| Source CIDR | IP Protocol | Destination Port |
| ----------- | ----------- | ---------------- |
| `0.0.0.0/0` | TCP         | `80`             |
| `0.0.0.0/0` | TCP         | `443`            |

(Port 22 for SSH is already open. The setup script opens 80 and 443 inside the server too.)

## 4. Point your domain at the server (recommended)

In **GoDaddy** (or wherever your domain is): **My Products → Domain → DNS → Add New Record**:

| Type | Name  | Value                   | TTL      |
| ---- | ----- | ----------------------- | -------- |
| A    | `erp` | your server's public IP | 1/2 hour |

That makes the ERP's address `erp.yourdomain`. Changes usually work within minutes but can take a few hours.

**No domain?** Skip this. The setup script can use a free address like `141-147-x-x.sslip.io` instead, and you can switch to your own domain later by rerunning setup with `sudo DOMAIN=erp.yourdomain bash setup.sh`.

## 5. Connect to the server

Open **Terminal** (Mac) or **PowerShell** (Windows) and run, using your key file and IP:

```bash
ssh -i path/to/ssh-key.key ubuntu@YOUR_SERVER_IP
```

- Mac/Linux: if it complains the key is "too open", run `chmod 600 path/to/ssh-key.key` first.
- Windows: drag the key file into the PowerShell window to fill in its path.
- Type `yes` the first time it asks about the fingerprint.

You're in when the prompt looks like `ubuntu@lowcaps-erp:~$`.

## 6. Put the setup script on the server

1. In GitHub, open `erp/deploy/setup.sh` on the branch that holds the ERP, click **Raw**, select everything and copy it.
2. On the server:

   ```bash
   nano setup.sh
   ```

   Paste (right-click in most terminals), then press **Ctrl+O**, **Enter**, **Ctrl+X** to save and exit.

## 7. Run it

```bash
sudo bash setup.sh
```

It will:

1. Install Node.js, Caddy (the web server that handles HTTPS) and other tools.
2. **Show a "deploy key"** and stop. This lets the server download the code from your private GitHub repo, read-only:
   - On GitHub: your repository → **Settings → Deploy keys → Add deploy key**.
   - Title `Oracle ERP server`, paste the key, leave **Allow write access** unticked, **Add key**.
   - Back on the server, press **Enter**.
3. Download the ERP and run its tests.
4. **Ask for the web address**: type `erp.yourdomain`, or press Enter for the free sslip.io address.
5. Set up HTTPS, the firewall, nightly backups, and start everything.

It finishes with **Open: https://…**.

## 8. Create the admin account (right away)

Open that address. **The first person to open it becomes the administrator**, so do this immediately, then add your staff under **Users**.

The first visit can take up to a minute while the HTTPS certificate is issued.

---

## Everyday tasks

All commands are run on the server after connecting with `ssh` (step 5).

**Install the latest version** after changes are pushed to GitHub:

```bash
sudo bash /opt/lowcaps-erp/erp/deploy/update.sh
```

It backs up the database, downloads the new code, runs the tests, and only restarts if they pass.

**See what the ERP is doing / errors:**

```bash
sudo journalctl -u lowcaps-erp -f      # Ctrl+C to stop watching
sudo systemctl status lowcaps-erp caddy
```

**Backups** run every night at 02:30 (UAE time) into `/var/backups/lowcaps-erp`, and are kept for 30 days. Back up now:

```bash
sudo /usr/local/bin/lowcaps-erp-backup
```

**Keep a copy off the server.** Backups on the server don't help if the server itself is lost. About once a week, copy the latest one to your PC:

```bash
# on the server
sudo sh -c 'cp "$(ls -t /var/backups/lowcaps-erp/*.gz | head -1)" /home/ubuntu/latest-backup.db.gz && chown ubuntu /home/ubuntu/latest-backup.db.gz'
# then on your PC (new terminal window)
scp -i path/to/ssh-key.key ubuntu@YOUR_SERVER_IP:latest-backup.db.gz .
```

**Restore a backup** (replaces the current data):

```bash
sudo systemctl stop lowcaps-erp
sudo sh -c 'zcat /var/backups/lowcaps-erp/lowcaps-YYYY-MM-DD_HHMM.db.gz > /var/lib/lowcaps-erp/lowcaps.db'
sudo rm -f /var/lib/lowcaps-erp/lowcaps.db-wal /var/lib/lowcaps-erp/lowcaps.db-shm
sudo chown lowcaps:lowcaps /var/lib/lowcaps-erp/lowcaps.db
sudo systemctl start lowcaps-erp
```

**Keep Ubuntu patched** (every month or so):

```bash
sudo apt update && sudo apt upgrade -y && sudo reboot
```

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| Browser can't reach the site at all | Check step 3 (ports 80 and 443 in the Security List). Check the DNS record points at the right IP: `nslookup erp.yourdomain`. |
| Certificate / "not secure" error | DNS must point at the server *before* Caddy can get a certificate. Once it does, run `sudo systemctl restart caddy` and wait a minute. Details: `sudo journalctl -u caddy -n 50`. |
| "Out of capacity" when creating the server | Try another availability domain, try later, or use `VM.Standard.E2.1.Micro` (step 2). |
| Setup keeps asking for the deploy key | Make sure you added the key shown on screen to the **same repository**, under Deploy keys (not your account's SSH keys). |
| Locked out of the admin account | Ask another admin to reset your password under **Users**. |
| Server was stopped by Oracle | Start it again from Compute → Instances, and upgrade to Pay As You Go (see "Before you start") so it doesn't happen again. |

## Where things live on the server

| What | Where |
| ---- | ----- |
| ERP code (from GitHub) | `/opt/lowcaps-erp` |
| Database | `/var/lib/lowcaps-erp/lowcaps.db` |
| Backups | `/var/backups/lowcaps-erp` |
| ERP service | `lowcaps-erp` (systemd), runs as user `lowcaps` on `127.0.0.1:3000` |
| HTTPS / web server | Caddy, config in `/etc/caddy/Caddyfile` |
