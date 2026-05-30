# v0.0.13 — 2026-05-30

🔧 Bug fixes & improvements

## Changes

- add download button to file tree — download files from remote agents to local device
- fix empty code blocks — handle both string and object token formats from marked
- fix undefined in code blocks — fallback to raw token when text is undefined
- unified font scaling — chat bubbles, code viewer, markdown all share --stoa-msg-scale
- hide console windows on git commands + add timeout to prevent zombie processes
- auto-refresh workspace on agent activity — file tree and git diff update after message complete and tool steps
- add git diff proxy for remote agents, auto-fetch on room join, badge on Git tab
- fix markdown h1 font-size 28px → 30px per design spec
- bump CLIENT_VERSION to 0.2.35
- add syntax highlighting to code viewer + modified file indicators in file tree
- audit round 4 fixes — res.ok checks on actor lang, rescan, force-update
- audit round 3 fixes — res.ok checks, missing indexes, rooms query LIMIT
- audit round 2 fixes — error handling, docs accuracy, top-level catch 500
- audit fixes — close path traversal vulnerabilities, add error checks, document workspace panel
- fix duplicate tab on image open — preserve original path in proxy response
- fix file tree click using wrong path — use absolute path from tree root for remote files
- fix empty files not rendering — use loaded flag instead of content truthiness
- auto force-update agents on connect when version is outdated
- bump CLIENT_VERSION to 0.2.34 — trigger auto-update for binary file proxy
- fix remote file viewing — proxy text and binary (base64) through agent WebSocket
- fix absolute path tree overwritten by workdir — avoid duplicate file_list request
- support absolute paths from chat — browse any directory on agent's machine
- fix remote file browsing — check fs.existsSync before assuming local read success
- fix directory path click — force file_list request, add error logging
- bump CLIENT_VERSION to 0.2.33 — trigger auto-update for remote agents
- fix missing closing brace in file_read handler causing server crash
- proxy file operations through agent WebSocket — support remote agent file browsing
- improve file path detection — support directory paths, code blocks, no-extension paths
- add clickable file paths in chat — click path in message to open in workspace panel
- unify AI and human bubble font size to 16px — consistent reading controls for both
- fix AI bubble not responding to reading controls — remove inline font-size overrides
- fix image preview URL — use query parameter for file path to avoid slash encoding issues
- add image preview support in workspace panel — HTTP endpoint + centered display
- remove sidebar collapsed persistence — always start with room list open on refresh
- fix blank screen on refresh with collapsed sidebar — show rooms toggle on empty state
- add proper markdown styling for workspace viewer — headings, lists, code blocks, tables
- auto-request file tree on room join — workspace ready when panel opens
- fix message actions position (above bubble), update bubble font sizes, add sidebar collapse button
- wire workspace panel to backend — file:list, file:read, git:diff endpoints
- implement full dev workspace panel — tab bar, file tree, code viewer, diff viewer, markdown, editing banner
- add reading comfort controls — text size, line spacing, bubble width in Settings General
- update syntax highlighting colors to Hearth design palette
- add dev workspace panel shell — resizable split-pane with toggle button
- add syntax highlighting for code blocks — highlight.js + custom warm theme
