# v0.0.4 — 2026-05-19

🔧 Bug fixes & improvements

## Changes

- update CHANGELOG for v0.0.4 — Gemini backend, language selection, XSS fix
- fix XSS — sanitize marked.parse() output with DOMPurify, strengthen install script tests
- document multi-model backend (Gemini) and agent language selection in usage guides
- @ fix voice STT docs — correct default language, toggle button, and command table
- add Japanese, Korean, and Chinese translations for 4 docs
- reduce dropdown font size in add-agent panel to prevent text clipping
- change docs language selector from pill buttons to dropdown
- add language selector in agent settings panel
- add language selection for agents, voice STT, and docs
- add setup progress bar during agent installation
- use specific session ID for Gemini resume instead of 'latest'
- remove debug logging from gemini-session.js
- fix Gemini session resume — don't use --session-id with -r latest
- fix create room when agent has no workdirs — show new folder option
- scan Gemini skills via CLI command instead of filesystem
- remove completed Gemini workdir scanner from TODO
- skip workdir scan for Gemini agents, disable dropdown in room creation
- redesign Add Agent panel — move above list, AI Agent dropdown, reorder fields
- rename settings tab from 'claude' to 'AI Agent'
- fix Gemini spawn — pass prompt via stdin, use shell: true for .cmd
- fix Gemini spawn — use gemini.cmd on Windows instead of shell: true
- remove resolved Gemini spawn ENOENT from TODO
- fix Gemini spawn ENOENT — add shell: true for .cmd resolution on Windows
- clean up TODO — remove all completed items
- add Gemini spawn ENOENT bug to TODO priority 1
- update TODO — Gemini CLI backend done, add workdir scanner filter item
- fix PS1 ecosystem.config.js syntax — use colon not equals for JS object
- wrap trust commands in try/catch for PowerShell ErrorActionPreference
- quote install URLs in generated commands for PowerShell & safety
- implement Gemini CLI as additional AI backend
- fix agent file upload: authenticate via X-Agent-Id/Secret headers
- fix agent file upload auth — exempt /api/upload/raw for agents
- audit round 2: security fix, error handling, dead CSS, docs
- compact table styling — smaller font, tighter padding, horizontal scroll
- fix path traversal: validate avatar_url and attachment URLs
- audit fixes: frontend error handling, docs accuracy and missing features
- docs: add voice commands and Android behavior differences to browser setup guide
- Android voice: stop instead of auto-restart on recognition end — eliminates ding and duplication
- fix room list rows shrinking — add flex-shrink:0 so cells keep fixed height and scroll
- fix text field accepting keyboard input during AI processing — blur on processing start
- allow mic button to be toggled while AI is processing
- fix Android voice ding — use continuous:true with per-index result tracking
- fix Android voice ding — use continuous:true with per-index result tracking
- fix Android voice input — use non-continuous mode to prevent text duplication, handle no-speech errors gracefully
- fix voice input text duplication on Android — rebuild finalTranscript from all results instead of appending
