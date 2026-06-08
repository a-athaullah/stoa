const Database = require('better-sqlite3');
const { dbPath, ensureDirs } = require('../paths');

ensureDirs();
const db = new Database(dbPath());

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
