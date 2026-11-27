'use strict';

// Starts a throwaway local PostgreSQL 16 cluster with the Supabase emulation and schema.sql loaded.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');

const PG_BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const SCHEMA = path.join(__dirname, '..', 'supabase', 'schema.sql');
const EMULATION = path.join(__dirname, 'emulate-supabase.sql');

// initdb refuses to run as root; use the "postgres" system user when we are root.
function run(bin, args) {
  const cmd = path.join(PG_BIN, bin);
  if (process.getuid && process.getuid() === 0) {
    return execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe' });
  }
  return execFileSync(cmd, args, { stdio: 'pipe' });
}

async function startLocalDb({ port = 54329, dir, schemas = [SCHEMA] } = {}) {
  const dataDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'lowcaps-pg-'));
  if (process.getuid && process.getuid() === 0) execFileSync('chown', ['-R', 'postgres:postgres', dataDir]);

  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C.UTF-8']);
  run('pg_ctl', ['-D', dataDir, '-l', path.join(dataDir, 'server.log'), '-w', '-o',
    `-p ${port} -k ${dataDir} -c listen_addresses=127.0.0.1`, 'start']);

  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 5 });
  await pool.query(fs.readFileSync(EMULATION, 'utf8'));
  for (const file of schemas) await pool.query(fs.readFileSync(file, 'utf8'));

  return {
    pool,
    port,
    async stop() {
      await pool.end();
      run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop']);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startLocalDb };
