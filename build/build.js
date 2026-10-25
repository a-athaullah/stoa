#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The live server reads dist/stoa.js per request for /api/client/manifest, so writing it
// from a branch checkout pushes unmerged code to every agent (auto-update + restart).
// server.js already rebuilds the agent bundle on every start, so the frontend build leaves
// it alone; `--agent` opts in, into STOA_AGENT_BUNDLE_DIR when set (like server.js).
function agentBundleTarget(argv, env, rootDir) {
  if (!argv.includes('--agent')) return null;
  return path.join(env.STOA_AGENT_BUNDLE_DIR || path.join(rootDir, 'dist'), 'stoa.js');
}
// index.html lists the app CSS/JS between {{APP_CSS}} / {{APP_JS}} markers; the bundle is
// those files in that order, and useAppBundle swaps each block for its single bundle tag.
const APP_CSS_BLOCK = /<!-- \{\{APP_CSS\}\} -->[\s\S]*?<!-- \{\{\/APP_CSS\}\} -->/;
const APP_JS_BLOCK = /<!-- \{\{APP_JS\}\} -->[\s\S]*?<!-- \{\{\/APP_JS\}\} -->/;

function appBundleSources(pub) {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const block = (re, marker) => {
    const m = html.match(re);
    if (!m) throw new Error(`marker ${marker} not found in index.html`);
    return m[0];
  };
  const css = [...block(APP_CSS_BLOCK, 'APP_CSS').matchAll(/href="\/css\/([^"]+\.css)"/g)].map(m => m[1]);
  if (!css.length) throw new Error('APP_CSS block has no CSS files');
  const js = [...block(APP_JS_BLOCK, 'APP_JS').matchAll(/src="\/js\/([^"]+\.js)"/g)].map(m => m[1]);
  // Vendor UMD libs must be loaded outside APP_JS (as separate script tags) so they remain globals in prod
  js.forEach(src => {
    if (src.startsWith('vendor/')) throw new Error(`vendor file must not be inside APP_JS block: ${src} — move it outside the markers`);
  });
  if (!js.length) throw new Error('APP_JS block has no JS files');
  const files = { css: css.map(f => path.join(pub, 'css', f)), js: js.map(f => path.join(pub, 'js', f)) };
  [...files.js, ...files.css].forEach(p => {
    if (!fs.existsSync(p)) throw new Error(`listed in index.html but not found: ${p}`);
  });
  return files;
}

// Minify without bundling: keeps the CSS cascade, and keeps top-level JS names global for
// the inline HTML handlers. Both files are fully written before either replaces the old
// pair, so a failed build throws and leaves no half-new bundle behind.
function buildAppBundle(rootDir, { outDir = path.join(rootDir, 'public', 'dist') } = {}) {
  const { transformSync } = require('esbuild');
  const src = appBundleSources(path.join(rootDir, 'public'));
  const css = transformSync(src.css.map(f => fs.readFileSync(f, 'utf8')).join('\n'), { loader: 'css', minify: true }).code;
  const js = transformSync(src.js.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n'), { loader: 'js', minify: true }).code;
  fs.mkdirSync(outDir, { recursive: true });
  const out = { css: path.join(outDir, 'stoa.min.css'), js: path.join(outDir, 'stoa.min.js') };
  const tmp = { css: `${out.css}.${process.pid}.tmp`, js: `${out.js}.${process.pid}.tmp` };
  try {
    fs.writeFileSync(tmp.css, css);
    fs.writeFileSync(tmp.js, js);
    fs.renameSync(tmp.css, out.css);
    fs.renameSync(tmp.js, out.js);
  } finally {
    for (const f of Object.values(tmp)) fs.rmSync(f, { force: true });
  }
  return out;
}

// server.js start-up (production): true only when this start produced the bundle, so a
// failed build serves the per-module files instead of whatever stale bundle is on disk.
function bootAppBundle(rootDir, log = console) {
  try {
    buildAppBundle(rootDir);
    log.log('[build] App bundle ready');
    return true;
  } catch (e) {
    log.error('[build] App bundle FAILED — serving per-module CSS/JS:', e.message);
    return false;
  }
}

function useAppBundle(html) {
  return html
    .replace(APP_CSS_BLOCK, '<link rel="stylesheet" href="/dist/stoa.min.css">')
    .replace(APP_JS_BLOCK, '<script src="/dist/stoa.min.js"></script>');
}

module.exports = { agentBundleTarget, buildAppBundle, bootAppBundle, useAppBundle };
if (require.main !== module) return;

const pub = path.join(root, 'public');
const vendor = path.join(pub, 'vendor');
const dist = path.join(pub, 'dist');

if (!fs.existsSync(vendor)) fs.mkdirSync(vendor, { recursive: true });

// ── Vendor bundles ──
fs.copyFileSync(path.join(root, 'node_modules/marked/lib/marked.umd.js'), path.join(vendor, 'marked.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), path.join(vendor, 'purify.min.js'));
execSync(`npx esbuild build/hljs-entry.js --bundle --minify --format=iife --outfile=public/vendor/highlight.min.js`, { cwd: root, stdio: 'inherit' });
execSync(`npx esbuild build/codemirror-entry.js --bundle --minify --format=esm --outfile=public/vendor/codemirror.bundle.js`, { cwd: root, stdio: 'inherit' });

// ── App CSS/JS → dist/stoa.min.css + dist/stoa.min.js (server.js also builds these on a production start) ──
buildAppBundle(root);

// ── Agent bundle (opt-in): stoa.js + lib/* → dist/stoa.js ──
const agentOut = agentBundleTarget(process.argv.slice(2), process.env, root);
if (agentOut) {
  fs.mkdirSync(path.dirname(agentOut), { recursive: true });
  execSync(`npx esbuild stoa.js --bundle --platform=node --target=node18 --external:ws --external:./claude-session --external:./codex-session --outfile=${JSON.stringify(agentOut)}`, { cwd: root, stdio: 'inherit' });
}

// ── Summary ──
const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + 'KB';
console.log(`\n✓ Build complete`);
console.log(`  vendor/  — marked ${size(path.join(vendor, 'marked.min.js'))}, purify ${size(path.join(vendor, 'purify.min.js'))}, hljs ${size(path.join(vendor, 'highlight.min.js'))}, codemirror ${size(path.join(vendor, 'codemirror.bundle.js'))}`);
console.log(`  dist/    — stoa.min.css ${size(path.join(dist, 'stoa.min.css'))}, stoa.min.js ${size(path.join(dist, 'stoa.min.js'))}`);
console.log(agentOut ? `  agent/   — ${agentOut.startsWith(root + path.sep) ? path.relative(root, agentOut) : agentOut} ${size(agentOut)}` : '  agent/   — skipped (server.js builds dist/stoa.js on start; --agent to force)');
