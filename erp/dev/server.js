'use strict';

// Run the ERP locally without a Supabase project: `npm install && npm start` in erp/dev,
// then open http://127.0.0.1:8787/erp/. Data lives in a temporary database and is deleted
// when you stop the server (Ctrl+C).

const http = require('node:http');
const { startLocalDb } = require('./local-db');
const { createStandIn } = require('./stand-in');

const PORT = Number(process.env.PORT) || 8787;

(async () => {
  const db = await startLocalDb({ port: Number(process.env.PG_PORT) || 54329 });
  // Local convenience only: the first account created is made an admin automatically.
  // On Supabase you do this once with the SQL line in supabase/schema.sql.
  const onSignup = async user => {
    const { rowCount } = await db.pool.query(
      "update public.profiles set role = 'admin', active = true where id = $1 and not exists (select 1 from public.profiles where role = 'admin')",
      [user.id]);
    if (rowCount) console.log(`${user.email} is the first account, so it was made an admin.`);
  };
  const server = http.createServer(createStandIn({ pool: db.pool, minPasswordLength: 10, onSignup }));
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Lowcaps ERP (local test mode) at http://127.0.0.1:${PORT}/erp/`);
    console.log('Create an account; the first one becomes the admin. Data is deleted when you stop (Ctrl+C).');
  });
  const stop = async () => {
    server.close();
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(err => {
  console.error(err.stderr ? err.stderr.toString() : err);
  process.exit(1);
});
