# v0.0.18 — 2026-05-30

🔧 Bug fixes & improvements

## Changes

- harden isPathSafe — block symlinks, fix Windows case sensitivity
- fix pre-existing security issues — symlink traversal, XSS mention
- audit round 3 — rename char validation, log sanitization, XSS fix
- fix path traversal in stoa.js proxy handlers + add missing protections
- audit fixes — path check consistency, memory leak prevention
- add CodeMirror 6 editor with Hearth theme
- add conflict detection and auto-save drafts
- add file management — context menu, create, delete, rename
- add remote file editor — edit mode, textarea, save, expand/collapse
- add backend handlers for file write, create, delete, rename
