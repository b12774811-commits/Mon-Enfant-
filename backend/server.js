const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { customAlphabet } = require('nanoid');

const app = express();
app.use(cors());
app.use(express.json());

const db = new DatabaseSync(path.join(__dirname, 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    recorded_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    FOREIGN KEY (child_id) REFERENCES children (id)
  );

  CREATE INDEX IF NOT EXISTS idx_positions_child_time
    ON positions (child_id, recorded_at DESC);
`);

const generateChildId = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
}

function verifyPin(pin, salt, expectedHash) {
  const hash = hashPin(pin, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

// ------------------------------------------------------------------
// SANTÉ / DIAGNOSTIC
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// NOUVEAU : liste tous les appareils enregistrés (utile pour vérifier
// si la base de données a été réinitialisée par Railway après un
// redémarrage — si un childId créé hier n'apparaît plus ici, c'est
// que la base a été effacée, probablement faute de volume persistant).
app.get('/api/debug/children', (req, res) => {
  const children = db
    .prepare('SELECT id, name, created_at FROM children ORDER BY created_at DESC')
    .all();
  res.json({ count: children.length, children });
});

// NOUVEAU : voir le nombre total de positions enregistrées, tous
// enfants confondus, avec la plus récente. Pratique pour vérifier en
// un coup d'œil si l'app enfant envoie quoi que ce soit.
app.get('/api/debug/positions', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM positions').get().n;
  const latest = db
    .prepare('SELECT * FROM positions ORDER BY received_at DESC LIMIT 5')
    .all();
  res.json({ count, latest });
});

// ------------------------------------------------------------------
// APPAIRAGE
// ------------------------------------------------------------------
app.post('/api/children', (req, res) => {
  const { name, pin } = req.body || {};

  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'Le PIN doit contenir 4 chiffres.' });
  }

  let childId;
  do {
    childId = generateChildId();
  } while (db.prepare('SELECT 1 FROM children WHERE id = ?').get(childId));

  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = hashPin(pin, salt);

  db.prepare(
    `INSERT INTO children (id, name, pin_hash, pin_salt, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(childId, name || null, pinHash, salt, new Date().toISOString());

  res.status(201).json({ childId });
});

app.post('/api/children/:childId/verify-pin', (req, res) => {
  const { childId } = req.params;
  const { pin } = req.body || {};

  const child = db
    .prepare('SELECT pin_hash, pin_salt FROM children WHERE id = ?')
    .get(childId);

  if (!child) {
    return res.status(404).json({ error: 'Appareil inconnu.' });
  }
  if (!pin) {
    return res.status(400).json({ error: 'PIN manquant.' });
  }

  const valid = verifyPin(pin, child.pin_salt, child.pin_hash);
  res.json({ valid });
});

// ------------------------------------------------------------------
// POSITIONS
// ------------------------------------------------------------------
app.post('/api/positions', (req, res) => {
  const { childId, latitude, longitude, accuracy, timestamp } = req.body || {};

  if (!childId || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const child = db.prepare('SELECT 1 FROM children WHERE id = ?').get(childId);
  if (!child) {
    return res.status(404).json({ error: 'Appareil non reconnu.' });
  }

  const recordedAt = timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();

  db.prepare(
    `INSERT INTO positions (child_id, latitude, longitude, accuracy, recorded_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    childId,
    latitude,
    longitude,
    accuracy ?? null,
    recordedAt,
    new Date().toISOString()
  );

  res.status(201).json({ success: true });
});

app.get('/api/children/:childId/positions/latest', (req, res) => {
  const { childId } = req.params;

  const position = db
    .prepare(
      `SELECT latitude, longitude, accuracy, recorded_at
       FROM positions WHERE child_id = ?
       ORDER BY recorded_at DESC LIMIT 1`
    )
    .get(childId);

  if (!position) {
    return res.status(404).json({ error: 'Aucune position enregistrée pour le moment.' });
  }

  res.json(position);
});

app.get('/api/children/:childId/positions/history', (req, res) => {
  const { childId } = req.params;
  const sinceParam = req.query.since;
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const positions = db
    .prepare(
      `SELECT latitude, longitude, accuracy, recorded_at
       FROM positions
       WHERE child_id = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC`
    )
    .all(childId, since.toISOString());

  res.json(positions);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur backend-suivi démarré sur le port ${PORT}`);
});
