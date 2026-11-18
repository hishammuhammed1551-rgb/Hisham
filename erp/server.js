'use strict';

const http = require('node:http');
const path = require('node:path');
const { openDatabase } = require('./lib/db');
const { createApp } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'lowcaps.db');

const db = openDatabase(DB_FILE);
const app = createApp({
  db,
  timeZone: process.env.TZ_BUSINESS || 'Asia/Dubai',
  // Set COOKIE_SECURE=true once the ERP is served over HTTPS.
  secureCookies: process.env.COOKIE_SECURE === 'true',
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Lowcaps ERP running at http://${HOST}:${PORT}  (database: ${DB_FILE})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
