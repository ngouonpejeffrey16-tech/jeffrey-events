'use strict';

const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'jeffrey-events.db');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) {
  console.error('ADMIN_TOKEN manquant ou trop court (12 caractères minimum). Voir .env.example.');
  process.exit(1);
}

const db = openDatabase(DB_FILE);
const app = createApp({ db, adminToken: ADMIN_TOKEN });

const server = app.listen(PORT, () => {
  console.log(`JEFFREY EVENTS en ligne sur http://localhost:${PORT}`);
  console.log(`Espace organisateur : http://localhost:${PORT}/admin`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
