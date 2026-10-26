// Fictional demo workspace for README/docs screenshots.
// Every name, room and message here is invented: never copy rows from the live DB.
'use strict';

const HUMAN = { name: 'Maya', color: '#b5835a', symbol: 'M' };

// Agents = machines running stoa.js. `online` ones get a fake WS connection in capture.js.
const AGENTS = [
  { key: 'atlas', name: 'Atlas', color: '#4d7f9f', symbol: '◈', model: 'claude-opus-5-5', online: true, workdir: '~/code/shopfront', machine: 'macOS' },
  { key: 'orion', name: 'Orion', color: '#5f8a6a', symbol: '◆', model: 'claude-sonnet-5-5', online: true, workdir: '/srv/infra', machine: 'Ubuntu' },
  { key: 'nova', name: 'Nova', color: '#8a6a9f', symbol: '✦', model: 'claude-sonnet-5-5', online: false, workdir: 'C:\\research', machine: 'Windows' },
];

const SUB_AGENTS = [
  { key: 'reviewer', parent: 'atlas', label: 'Reviewer', role: 'Code Reviewer', tier: 'deep', model: 'claude-opus-5-5', color: '#9f6a4d', symbol: 'R',
    description: 'Reviews a branch against main: correctness, security, test coverage. Read-only.' },
  { key: 'backend', parent: 'atlas', label: 'Backend', role: 'Backend Engineer', tier: 'deep', model: 'claude-opus-5-5', color: '#4d9f8a', symbol: 'B',
    description: 'Implements API endpoints, migrations and tests.' },
  { key: 'frontend', parent: 'atlas', label: 'Frontend', role: 'Frontend Engineer', tier: 'standard', model: 'claude-sonnet-5-5', color: '#6a7f9f', symbol: 'F',
    description: 'Builds UI components and keeps the design system consistent.' },
  { key: 'writer', parent: 'atlas', label: 'Writer', role: 'Technical Writer', tier: 'standard', model: 'claude-sonnet-5-5', color: '#9f8a4d', symbol: 'W',
    description: 'Keeps the docs and changelog in sync with each release.' },
];

// minutesAgo: message age when the demo is seeded. `by` = 'human' | agent key | 'agent:sub' for a sub-agent.
const ROOMS = [
  {
    key: 'checkout', title: 'Checkout v2 launch', pinned: true, model: 'claude-opus-5-5',
    memory: '## Release\nCheckout v2 ships Thursday. Staging deploy 08:00 the day before.\n## Decisions\n- Idempotency keys expire after 24h.\n- Saved cards: expired ones stay visible but disabled.\n## People\nMaya approves merges; Reviewer must report 0 blocking findings first.', agents: ['atlas', 'orion'], subs: ['reviewer', 'backend', 'frontend', 'writer'],
    messages: [
      { id: 'm1', by: 'human', ago: 95, text: '@Atlas we ship Checkout v2 on Thursday. Can you split the remaining work and get the team on it?' },
      { id: 'm2', by: 'atlas', ago: 93, steps: [['Read', 'docs/checkout-v2.md'], ['Grep', 'TODO(checkout) in src/'], ['Bash', 'git log --oneline main..checkout-v2']],
        text: 'Read the spec and the branch. Three things are left before Thursday:\n\n| Area | Work | Owner |\n|---|---|---|\n| API | Idempotency keys on `POST /orders` | Backend |\n| UI | Saved-card picker + error states | Frontend |\n| Docs | Payment-retry section, 5 languages | Writer |\n\nStarting all three in parallel. I\'ll ask Reviewer to check the branch once they land.' },
      { id: 'm3', by: 'atlas:backend', ago: 80, parentOf: 'm2', steps: [['Edit', 'src/api/orders.js'], ['Write', 'migrations/20261026-idempotency-keys.sql'], ['Bash', 'npm test -- orders']],
        text: 'Idempotency is in.\n\n```js\nconst key = req.headers[\'idempotency-key\'];\nconst prior = db.prepare(\'SELECT response FROM idem WHERE key = ?\').get(key);\nif (prior) return send(res, JSON.parse(prior.response));\n```\n\nA retried request now returns the first response instead of charging twice. **42 tests pass**, 6 of them new.' },
      { id: 'm4', by: 'atlas:frontend', ago: 74, parentOf: 'm2', steps: [['Read', 'src/ui/checkout/CardPicker.js'], ['Edit', 'src/ui/checkout/CardPicker.js'], ['Edit', 'src/ui/checkout/checkout.css']],
        text: 'Saved-card picker is done: keyboard navigable, expired cards greyed out, and the decline message now says which card failed. Screens checked in light and dark themes.' },
      { id: 'm5', by: 'atlas:reviewer', ago: 52, parentOf: 'm2', steps: [['Bash', 'git diff main..checkout-v2 --stat'], ['Read', 'src/api/orders.js'], ['Bash', 'npm test']],
        text: '**Review: 0 blocking findings.**\n\n- Idempotency rows expire after 24h. Good, the table won\'t grow forever.\n- One nit: the decline toast is read twice by screen readers. Fixed by Frontend in `a41c9e2`.\n\nBranch is ready to merge whenever you are.' },
      { id: 'm6', by: 'human', ago: 40, text: 'Nice work, everyone. @Orion can you prepare the staging deploy for tomorrow morning?' },
      { id: 'm7', by: 'orion', ago: 38, steps: [['Bash', 'kubectl get deploy -n staging'], ['Bash', 'helm diff upgrade shopfront ./chart']],
        text: 'Staging is healthy (3/3 pods). The Helm diff only touches the `shopfront` image tag and one new env var, `IDEMPOTENCY_TTL_HOURS=24`. Scheduled the deploy for **08:00 tomorrow**; I\'ll post the smoke-test results here.' },
    ],
    threads: [
      { root: 'm2', replies: [
        { by: 'human', ago: 70, text: 'Can the retry section also mention what the customer sees?' },
        { by: 'atlas', ago: 69, text: 'Yes. Asked Writer to add a "What your customer sees" box with the exact copy from the UI.' },
        { by: 'atlas:writer', ago: 60, steps: [['Read', 'docs/payments.en.md'], ['Edit', 'docs/payments.*.md']], text: 'Added it to all five languages, with the decline copy quoted verbatim so it stays in sync with the UI.' },
      ] },
    ],
  },
  {
    key: 'infra', title: 'Infra: staging cluster', model: 'claude-sonnet-5-5', agents: ['orion'], subs: [],
    messages: [
      { id: 'i1', by: 'human', ago: 300, text: '@Orion disk usage alert on staging-db-1 again. What\'s eating the space?' },
      { id: 'i2', by: 'orion', ago: 297, steps: [['Bash', 'df -h /var/lib/postgresql'], ['Bash', 'du -sh /var/lib/postgresql/*/pg_wal']],
        text: 'WAL archive. The replica slot `analytics_tmp` has been inactive for 9 days, so Postgres keeps every WAL segment for it (41 GB).\n\nDropping the slot frees the space immediately. Want me to do it?' },
      { id: 'i3', by: 'human', ago: 290, text: 'Yes, drop it.' },
      { id: 'i4', by: 'orion', ago: 288, steps: [['Bash', 'psql -c "SELECT pg_drop_replication_slot(\'analytics_tmp\')"']], text: 'Done. Disk is back to **38%**. Added an alert for slots inactive longer than 24h.' },
    ],
  },
  {
    key: 'research', title: 'Research: vector search', agents: ['nova'], subs: [],
    messages: [
      { id: 'r1', by: 'human', ago: 1500, text: '@Nova compare pgvector and a dedicated vector DB for ~2M product embeddings.' },
      { id: 'r2', by: 'nova', ago: 1490, text: 'At 2M vectors, **pgvector with HNSW** is enough: p95 under 20 ms in the published benchmarks, and it keeps search inside the database you already back up. A dedicated store starts to pay off past ~50M vectors or when you need multi-tenant isolation.' },
    ],
  },
  {
    key: 'support', title: 'Support inbox triage', agents: ['atlas'], subs: [],
    messages: [
      { id: 's1', by: 'atlas', ago: 20, text: 'New ticket from the support inbox: *"Charged twice for order #10482"*.\n\nMatched to the retry bug fixed in Checkout v2. Drafted a reply with the refund steps; waiting for your OK before sending.' },
    ],
  },
  {
    key: 'design', title: 'Design review', agents: ['atlas'], subs: ['frontend'],
    messages: [
      { id: 'd1', by: 'human', ago: 2900, text: '@Atlas the empty state on the orders page feels heavy. Ideas?' },
      { id: 'd2', by: 'atlas', ago: 2895, text: 'Drop the illustration, keep one sentence and the primary action. Frontend can mock both versions for comparison.' },
    ],
  },
];

module.exports = { HUMAN, AGENTS, SUB_AGENTS, ROOMS };
