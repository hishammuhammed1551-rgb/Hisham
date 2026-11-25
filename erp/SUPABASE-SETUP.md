# Putting Lowcaps ERP online with Supabase + GitHub Pages (free)

- **Supabase** (free plan) stores the data and handles staff sign-in.
- **GitHub Pages** (free for public repositories) serves the ERP pages.

The first time takes about 20–30 minutes, all in a web browser. No server, nothing to install.

> Supabase and GitHub change their menus from time to time. If a button has a slightly different name, look for the closest match. Free-plan limits also change, so check Supabase's pricing page for the current ones.

---

## 1. Create the Supabase project

1. Go to **supabase.com** → **Start your project**, and sign in (signing in with GitHub is easiest).
2. **New project**:
   - **Name:** `lowcaps-erp`
   - **Database password:** click *Generate*, then **save it somewhere safe** (a password manager). You only need it for full backups.
   - **Region:** Supabase has no UAE region. Pick the closest one offered, e.g. **Mumbai** or **Frankfurt**.
3. Click **Create new project** and wait a minute or two while it's set up.

## 2. Create the database

1. In GitHub, open `erp/supabase/schema.sql`, click **Raw**, select all and copy.
2. In Supabase: **SQL Editor** → **New query** → paste → **Run**.
3. You should see **"Success. No rows returned."** If Supabase asks you to confirm because the query contains statements it considers risky, confirm: the file only creates the ERP's tables and functions.

## 3. Sign-in settings

In Supabase, under **Authentication**:

1. **Sign In / Providers → Email:** make sure **Email** is enabled and **turn off "Confirm email"**.
   Why: Supabase's built-in email sender is only meant for testing, is heavily rate-limited, and may only deliver to your own Supabase team's addresses, so staff wouldn't receive confirmation emails. That's safe here: a new account can't see anything until an admin gives it access in the ERP.
2. **Password settings** (under *Policies*, *Password security* or the Email provider, depending on the version): set the **minimum password length to 10**.
3. **URL Configuration:**
   - **Site URL:** your ERP address from step 5, e.g. `https://hishammuhammed1551-rgb.github.io/Hisham/erp/`
   - **Redirect URLs:** add the same address.

## 4. Connect the ERP to your project

1. In Supabase: **Project Settings → API Keys** (or **API**). Copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`; on some versions it's under *Data API*)
   - the **anon** key (on the *Legacy API keys* tab) or the **publishable** key (`sb_publishable_…`)
2. **Never use the `service_role` / secret key** in the ERP. It bypasses all protection.
3. In GitHub, open `erp/config.js`, click the **pencil (edit)** icon, replace the two values, and **Commit changes**:

   ```js
   window.LOWCAPS_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     supabaseKey: 'eyJhbGciOi...your anon key...',
     minPasswordLength: 10,
   };
   ```

   Both values are designed to be public. The data is protected by the rules in `schema.sql`.

## 5. Publish the ERP with GitHub Pages

1. In GitHub: your repository → **Settings → Pages**.
2. **Source:** *Deploy from a branch*. **Branch:** the branch that holds the ERP, folder **/ (root)** → **Save**.
3. After a minute or two, the page shows your site's address. The ERP is at that address plus `erp/`, e.g.
   `https://hishammuhammed1551-rgb.github.io/Hisham/erp/`
   (The company website is at the same address without `erp/`.)

Make sure the Site URL in step 3 matches this address exactly.

## 6. Make yourself the administrator

1. Open the ERP address → **Create an account** with your name, email and a password. You'll see **"Waiting for access"**. That's expected.
2. In Supabase: **SQL Editor → New query**, run this with **your** email:

   ```sql
   update public.profiles set role = 'admin', active = true where email = 'you@example.com';
   ```

3. Back in the ERP, click **Check again**. You're in.

## 7. Add your team

1. Send staff the ERP address. They click **Create an account**.
2. In the ERP: **Users** → **Give access** next to each person you recognise. Use **Edit** to make someone an administrator, or to take access away (that works immediately, even if they're signed in).

Anyone on the internet can create an account, but it can't see or change anything until you give it access. Only approve people you know.

---

## Things to know about the free plan

- **Pausing:** Supabase pauses free projects after about a week with no activity. If that happens the ERP shows an error. Open the Supabase dashboard and click **Restore project**. If staff use it every working day, this shouldn't happen.
- **No automatic downloadable backups on the free plan.** Make your own regularly (see below).
- **Size:** the free database (about 500 MB) is plenty for years of customer records.
- **Forgotten passwords:** the "Forgot password?" link uses Supabase's built-in email, which is limited (see step 3), so it may only work for your own address. If a staff member is locked out: in Supabase → **Authentication → Users**, delete their login. They then **Create an account** again with the same email, and you **Give access** again. Customers and contacts are kept; their old activity entries remain but show the author as "Unknown". To make reset emails work for everyone instead, add a free email-sending service under **Project Settings → Authentication → SMTP** (for example Brevo or Resend have free tiers).

## Backups

**Quick (weekly):** in the ERP, **Customers → Export CSV** saves all customers as a spreadsheet.

**Complete:** in Supabase, **Table Editor** → open each of `customers`, `contacts`, `activities`, `profiles` → **Export → CSV**.

**Full database copy** (for someone comfortable with a terminal, with PostgreSQL tools installed): in Supabase click **Connect**, copy the *Session pooler* connection string, then:

```bash
pg_dump "postgresql://postgres.xxxx:YOUR-DB-PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres" \
  --schema=public --no-owner -f lowcaps-backup.sql
```

Keep backups somewhere private, **never in this GitHub repository** (it's public).

## Updating the ERP later

- **Page changes** (anything outside `supabase/`): pushed to the Pages branch, they go live within a few minutes.
- **Database changes** (`supabase/schema.sql` changed): copy the new file into the **SQL Editor** and **Run** again. It's safe to rerun; it keeps your data.

## Keep it secure

- Turn on **two-factor sign-in** for your Supabase and GitHub accounts. Whoever controls those controls the data.
- Never put the `service_role` key, the database password or any backup in the repository.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| "Connect the ERP to Supabase" page | `erp/config.js` still has the placeholder values (step 4), or the change isn't live yet; wait a few minutes. |
| "Something went wrong … Could not find the function" | `schema.sql` wasn't run, or not completely (step 2). Run it again. |
| "Invalid API key" | The key in `config.js` is wrong or incomplete. Copy it again (step 4). |
| Stuck on "Waiting for access" | An admin must click **Give access** under Users. For the very first admin, run the SQL in step 6, and check the email matches exactly. |
| Sign-up says to check email for a confirmation link | "Confirm email" is still on (step 3). |
| Everything fails after a quiet week | The project was paused. Restore it in the Supabase dashboard. |
| GitHub Pages shows 404 | Check step 5, and that the address ends in `/erp/`. |
