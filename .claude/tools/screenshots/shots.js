// Screenshot manifest for capture.js. Each shot: name, file (under docs/screenshots/),
// optional theme / viewport / scale / mobile / clip, `docs` = where the image is embedded (so a
// UI change can be traced to the shots it invalidates), and run(page, ctx) to reach the state.
'use strict';

const settle = (page, ms = 900) => page.waitForTimeout(ms);
// Park the pointer on the composer's empty footer: no hover state there (nav rail, message toolbars).
const parkMouse = page => page.mouse.move(1000, 880);

async function openRoom(page, { base, rooms }, key, threadId) {
  await page.goto(`${base}/r/${rooms[key]}${threadId ? `/t/${threadId}` : ''}`);
  await page.waitForSelector('.t-root-row', { timeout: 15000 });
  await settle(page, 1200);
}

// Start the feed at the first message so the conversation reads top-down.
async function scrollToFirst(page) {
  await page.evaluate(() => {
    let el = document.querySelector('.t-root-row');
    while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
    if (el) el.scrollTop = 0;
  });
  await settle(page, 500);
}

// Open a popover from the room's right icon strip (buttons are keyed by their tooltip text).
async function rsb(page, tooltip) {
  await page.click(`.h-rsb-btn[data-tooltip="${tooltip}"]`);
  await parkMouse(page);
  await page.evaluate(() => document.querySelectorAll('.h-fixed-tooltip').forEach(t => t.classList.remove('visible')));
  await settle(page);
}

async function nav(page, { base }, id) {
  await page.goto(base);
  await page.waitForSelector(`#nav-${id}`);
  await page.click(`#nav-${id}`);
  await parkMouse(page); // the nav rail expands while hovered
  await settle(page, 1200);
}

module.exports = [
  { name: 'hero', file: 'hero.png', docs: ['README.md'],
    run: async (page, ctx) => { await openRoom(page, ctx, 'checkout'); await scrollToFirst(page); } },
  { name: 'thread', file: 'thread.png', docs: ['README.md', 'docs/guide-usage.*.md#threads'],
    run: async (page, ctx) => { await openRoom(page, ctx, 'checkout', ctx.msgs.m2); await scrollToFirst(page); } },
  { name: 'dark', file: 'dark.png', theme: 'dark', docs: ['README.md'],
    run: async (page, ctx) => { await openRoom(page, ctx, 'checkout', ctx.msgs.m2); await scrollToFirst(page); } },
  { name: 'agents-panel', file: 'agents-panel.png', docs: ['README.md', 'docs/guide-usage.*.md#agents-panel'],
    run: async (page, ctx) => { await openRoom(page, ctx, 'checkout'); await scrollToFirst(page); await rsb(page, 'Agents'); } },
  { name: 'memory', file: 'memory.png', docs: ['README.md', 'docs/guide-usage.*.md#room-system-prompt--memory'],
    run: async (page, ctx) => {
      await openRoom(page, ctx, 'checkout'); await scrollToFirst(page); await rsb(page, 'Memory');
      await page.locator('.h-rsb-popover').getByText('Memory', { exact: true }).click();
      await parkMouse(page); await settle(page);
    } },
  { name: 'settings-agents', file: 'settings-agents.png', docs: ['README.md', 'docs/guide-usage.*.md#agent-management'], // EN; other langs: #manajemen-agent #エージェント管理 #에이전트-관리 #代理管理
    run: async (page, ctx) => {
      await nav(page, ctx, 'agents');
      await page.getByText('Atlas', { exact: true }).first().click();
      await parkMouse(page);
      await settle(page, 1200);
    } },
  { name: 'themes', file: 'themes.png', clip: { x: 0, y: 0, width: 1440, height: 630 }, docs: ['docs/guide-usage.*.md#themes'],
    run: async (page, ctx) => { await nav(page, ctx, 'themes'); } },
];
