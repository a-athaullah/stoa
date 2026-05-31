#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'public', 'vendor');

if (!fs.existsSync(vendor)) fs.mkdirSync(vendor, { recursive: true });

// Copy browser-ready vendor files
fs.copyFileSync(path.join(root, 'node_modules/marked/lib/marked.umd.js'), path.join(vendor, 'marked.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), path.join(vendor, 'purify.min.js'));

// Bundle highlight.js
execSync(`npx esbuild build/hljs-entry.js --bundle --minify --format=iife --outfile=public/vendor/highlight.min.js`, { cwd: root, stdio: 'inherit' });

// Bundle CodeMirror
execSync(`npx esbuild build/codemirror-entry.js --bundle --minify --format=esm --outfile=public/vendor/codemirror.bundle.js`, { cwd: root, stdio: 'inherit' });

console.log('\n✓ Vendor bundles built to public/vendor/');
