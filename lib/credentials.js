'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let _key = null;

function getKey() {
  if (_key) return _key;

  const envKey = process.env.STOA_CREDENTIALS_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length === KEY_LENGTH) { _key = buf; return _key; }
  }

  const keyFile = path.join(__dirname, '..', '.credentials-key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === KEY_LENGTH) { _key = buf; return _key; }
  }

  // Auto-generate key on first use
  _key = crypto.randomBytes(KEY_LENGTH);
  fs.writeFileSync(keyFile, _key.toString('hex') + '\n', { mode: 0o600 });
  return _key;
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext) {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, 'utf8') + decipher.final('utf8');
}

function isEncrypted(value) {
  return typeof value === 'string' && /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}

module.exports = { encrypt, decrypt, isEncrypted };
