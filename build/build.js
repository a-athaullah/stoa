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

// ── Parse index.html to derive file lists from APP_CSS / APP_JS blocks ──
function parseIndexBlock(marker) {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const open = `<!-- {{${marker}}} -->`;
  const close = `<!-- {{/${marker}}} -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (start === -1 || end === -1) throw new Error(`marker ${marker} not found in index.html`);
  return html.slice(start + open.length, end);
}

const cssBlock = parseIndexBlock('APP_CSS');
const cssFiles = [...cssBlock.matchAll(/href="\/css\/([^"]+\.css)"/g)].map(m => m[1].replace(/\.css$/, ''));
if (!cssFiles.length) throw new Error('APP_CSS block has no CSS files');

const jsBlock = parseIndexBlock('APP_JS');
const jsSrcs = [...jsBlock.matchAll(/src="\/js\/([^"]+\.js)"/g)].map(m => m[1]);
// Vendor UMD libs must be loaded outside APP_JS (as separate script tags) so they remain globals in prod
jsSrcs.forEach(src => {
  if (src.startsWith('vendor/')) throw new Error(`vendor file must not be inside APP_JS block: ${src} — move it outside the markers`);
});
const jsFiles = jsSrcs.map(s => s.replace(/\.js$/, ''));
if (!jsFiles.length) throw new Error('APP_JS block has no JS files');

// Fail early if any listed file is missing
jsFiles.forEach(f => {
  const p = path.join(pub, 'js', `${f}.js`);
  if (!fs.existsSync(p)) throw new Error(`listed in index.html but not found: ${p}`);
});
cssFiles.forEach(f => {
  const p = path.join(pub, 'css', `${f}.css`);
  if (!fs.existsSync(p)) throw new Error(`listed in index.html but not found: ${p}`);
});

// ── Minify app CSS → dist/stoa.min.css ──
// Use --minify without --bundle to preserve cascade without IIFE wrapping
const cssConcat = cssFiles.map(f => fs.readFileSync(path.join(pub, 'css', `${f}.css`), 'utf8')).join('\n');
fs.writeFileSync(path.join(dist, '_app.css'), cssConcat);
execSync(`npx esbuild public/dist/_app.css --minify --outfile=public/dist/stoa.min.css`, { cwd: root, stdio: 'inherit' });
fs.unlinkSync(path.join(dist, '_app.css'));

// ── Minify app JS → dist/stoa.min.js ──
// --minify without --bundle preserves top-level globals accessible from inline HTML handlers
const jsConcat = jsFiles.map(f => fs.readFileSync(path.join(pub, 'js', `${f}.js`), 'utf8')).join('\n;\n');
fs.writeFileSync(path.join(dist, '_app.js'), jsConcat);
execSync(`npx esbuild public/dist/_app.js --minify --outfile=public/dist/stoa.min.js`, { cwd: root, stdio: 'inherit' });
fs.unlinkSync(path.join(dist, '_app.js'));

// ── Agent bundle: stoa.js + lib/* → dist/stoa.js ──
const agentDist = path.join(root, 'dist');
if (!fs.existsSync(agentDist)) fs.mkdirSync(agentDist, { recursive: true });
execSync(`npx esbuild stoa.js --bundle --platform=node --target=node18 --external:ws --external:./claude-session --external:./codex-session --outfile=dist/stoa.js`, { cwd: root, stdio: 'inherit' });

// ── Summary ──
const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + 'KB';
console.log(`\n✓ Build complete`);
console.log(`  vendor/  — marked ${size(path.join(vendor, 'marked.min.js'))}, purify ${size(path.join(vendor, 'purify.min.js'))}, hljs ${size(path.join(vendor, 'highlight.min.js'))}, codemirror ${size(path.join(vendor, 'codemirror.bundle.js'))}`);
console.log(`  dist/    — stoa.min.css ${size(path.join(dist, 'stoa.min.css'))}, stoa.min.js ${size(path.join(dist, 'stoa.min.js'))}`);
console.log(`  agent/   — dist/stoa.js ${size(path.join(agentDist, 'stoa.js'))}`);
