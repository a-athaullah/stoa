# v — 2026-06-08

✨ New features

## Changes

- fix queue-manager: emit error crash + missing drain cleanup
- remove unnecessary 300ms delay in automation queue
- use dedicated roomIdleBus instead of process for room idle signals
- wrap triggerAgentsSequential in try/finally for reliable cleanup
- add per-room automation queue system
- show token plain text in edit connection form
- show existing tokens pre-filled in edit connection form
- show delete button on error state connections
- add multi-connection Slack pool for automations
- feat: configurable auto-compact threshold
- feat: migration system + model switching (#5)
- pin room: pin up to 5 rooms to sidebar top (#4)
- fix: call ack() in all Slack Socket Mode event handlers
