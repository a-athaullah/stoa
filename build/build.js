#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const vendor = path.join(pub, 'vendor');
const dist = path.join(pub, 'dist');

if (!fs.existsSync(vendor)) fs.mkdirSync(vendor, { recursive: true });
if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

// ── Vendor bundles ──
fs.copyFileSync(path.join(root, 'node_modules/marked/lib/marked.umd.js'), path.join(vendor, 'marked.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), path.join(vendor, 'purify.min.js'));
execSync(`npx esbuild build/hljs-entry.js --bundle --minify --format=iife --outfile=public/vendor/highlight.min.js`, { cwd: root, stdio: 'inherit' });
execSync(`npx esbuild build/codemirror-entry.js --bundle --minify --format=esm --outfile=public/vendor/codemirror.bundle.js`, { cwd: root, stdio: 'inherit' });

// ── Minify app CSS → dist/stoa.min.css ──
const cssFiles = ['base', 'layout', 'workspace', 'chat', 'components'];
const cssConcat = cssFiles.map(f => fs.readFileSync(path.join(pub, 'css', `${f}.css`), 'utf8')).join('\n');
fs.writeFileSync(path.join(dist, '_app.css'), cssConcat);
execSync(`npx esbuild public/dist/_app.css --bundle --minify --outfile=public/dist/stoa.min.css`, { cwd: root, stdio: 'inherit' });
fs.unlinkSync(path.join(dist, '_app.css'));

// ── Minify app JS → dist/stoa.min.js ──
const jsFiles = [
  'core',
  'rooms/header', 'rooms/sidebar', 'rooms/list', 'rooms/open',
  'websocket',
  'workspace/panel', 'workspace/edit-mode', 'workspace/codemirror', 'workspace/dialogs', 'workspace/files',
  'markdown',
  'chat/append', 'chat/thinking', 'chat/stream', 'chat/trail', 'chat/invite', 'chat/upload',
  'composer/emoji', 'composer/input', 'composer/rooms-modal',
  'composer/scroll', 'composer/search', 'composer/utils', 'composer/models',
  'settings/agents', 'settings/agents-add', 'settings/tabs',
  'settings/docs', 'settings/appearance', 'settings/platforms', 'settings/account',
  'settings/init',
  'init/setup', 'init/main', 'init/pwa', 'init/speech',
  'automation/state', 'automation/connections', 'automation/automations', 'automation/events', 'automation/api',
];
const jsConcat = jsFiles.map(f => fs.readFileSync(path.join(pub, 'js', `${f}.js`), 'utf8')).join('\n;\n');
fs.writeFileSync(path.join(dist, '_app.js'), jsConcat);
execSync(`npx esbuild public/dist/_app.js --bundle --minify --outfile=public/dist/stoa.min.js`, { cwd: root, stdio: 'inherit' });
fs.unlinkSync(path.join(dist, '_app.js'));

// ── Summary ──
const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + 'KB';
console.log(`\n✓ Build complete`);
console.log(`  vendor/  — marked ${size(path.join(vendor, 'marked.min.js'))}, purify ${size(path.join(vendor, 'purify.min.js'))}, hljs ${size(path.join(vendor, 'highlight.min.js'))}, codemirror ${size(path.join(vendor, 'codemirror.bundle.js'))}`);
console.log(`  dist/    — stoa.min.css ${size(path.join(dist, 'stoa.min.css'))}, stoa.min.js ${size(path.join(dist, 'stoa.min.js'))}`);
