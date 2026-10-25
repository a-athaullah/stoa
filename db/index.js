const path = require('path');
const { openSqliteOrExit } = require('../lib/sqlite-abi');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'stoa.db');
const db = openSqliteOrExit(() => new (require('better-sqlite3'))(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
