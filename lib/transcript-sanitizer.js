'use strict';

const PLACEHOLDER_TEXT = '(content elided)';
const STUB_RESULT_TEXT = '(result unavailable)';

function findAnomalies(entries) {
  const toolUseIds = new Map();
  const toolResultIds = new Map();
  const anomalies = { orphanResults: [], missingResults: [], duplicateIds: [], emptyTurns: [] };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;

    const content = entry.content;
    if (!Array.isArray(content) || content.length === 0) {
      if (entry.role === 'assistant' || entry.role === 'user') {
        anomalies.emptyTurns.push(i);
      }
      continue;
    }

    for (let j = 0; j < content.length; j++) {
      const block = content[j];
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'tool_use' && block.id) {
        if (toolUseIds.has(block.id)) {
          anomalies.duplicateIds.push({ entryIdx: i, blockIdx: j, id: block.id, firstEntry: toolUseIds.get(block.id).entryIdx });
        } else {
          toolUseIds.set(block.id, { entryIdx: i, blockIdx: j });
        }
      }

      if (block.type === 'tool_result' && block.tool_use_id) {
        toolResultIds.set(block.tool_use_id, { entryIdx: i, blockIdx: j });
      }
    }
  }

  for (const [id, loc] of toolUseIds) {
    if (!toolResultIds.has(id)) {
      anomalies.missingResults.push({ id, entryIdx: loc.entryIdx });
    }
  }

  for (const [id, loc] of toolResultIds) {
    if (!toolUseIds.has(id)) {
      anomalies.orphanResults.push({ id, entryIdx: loc.entryIdx, blockIdx: loc.blockIdx });
    }
  }

  return anomalies;
}

function hasAnomalies(anomalies) {
  return anomalies.orphanResults.length > 0
    || anomalies.missingResults.length > 0
    || anomalies.duplicateIds.length > 0
    || anomalies.emptyTurns.length > 0;
}

function anomalyCount(anomalies) {
  return anomalies.orphanResults.length + anomalies.missingResults.length
    + anomalies.duplicateIds.length + anomalies.emptyTurns.length;
}

function fixAnomalies(entries, anomalies) {
  let fixed = 0;

  for (const dup of anomalies.duplicateIds) {
    const entry = entries[dup.entryIdx];
    if (!entry?.content?.[dup.blockIdx]) continue;
    const block = entry.content[dup.blockIdx];
    const newId = block.id + '-dup-' + dup.blockIdx;
    block.id = newId;
    for (const e of entries) {
      if (!Array.isArray(e?.content)) continue;
      for (const b of e.content) {
        if (b?.type === 'tool_result' && b.tool_use_id === dup.id) {
          const useEntry = entries[dup.firstEntry];
          const origStillExists = useEntry?.content?.some(bl => bl?.type === 'tool_use' && bl.id === dup.id);
          if (origStillExists) {
            b.tool_use_id = newId;
            break;
          }
        }
      }
    }
    fixed++;
  }

  const orphanBlocksToRemove = new Map();
  for (const orphan of anomalies.orphanResults) {
    if (!orphanBlocksToRemove.has(orphan.entryIdx)) {
      orphanBlocksToRemove.set(orphan.entryIdx, new Set());
    }
    orphanBlocksToRemove.get(orphan.entryIdx).add(orphan.blockIdx);
    fixed++;
  }
  for (const [entryIdx, blockIdxs] of orphanBlocksToRemove) {
    const entry = entries[entryIdx];
    if (!Array.isArray(entry?.content)) continue;
    entry.content = entry.content.filter((_, idx) => !blockIdxs.has(idx));
  }

  for (const missing of anomalies.missingResults) {
    let targetIdx = missing.entryIdx + 1;
    while (targetIdx < entries.length && entries[targetIdx]?.role === 'assistant') {
      targetIdx++;
    }
    if (targetIdx < entries.length && entries[targetIdx]?.role === 'user') {
      if (!Array.isArray(entries[targetIdx].content)) {
        entries[targetIdx].content = [];
      }
      entries[targetIdx].content.push({
        type: 'tool_result',
        tool_use_id: missing.id,
        content: STUB_RESULT_TEXT,
      });
    } else {
      entries.splice(targetIdx, 0, {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: missing.id,
          content: STUB_RESULT_TEXT,
        }],
      });
    }
    fixed++;
  }

  for (const emptyIdx of anomalies.emptyTurns) {
    const entry = entries[emptyIdx];
    if (!entry) continue;
    if (!Array.isArray(entry.content) || entry.content.length === 0) {
      entry.content = [{ type: 'text', text: PLACEHOLDER_TEXT }];
      fixed++;
    }
  }

  for (const [entryIdx] of orphanBlocksToRemove) {
    const entry = entries[entryIdx];
    if (entry && Array.isArray(entry.content) && entry.content.length === 0) {
      entry.content = [{ type: 'text', text: PLACEHOLDER_TEXT }];
    }
  }

  return fixed;
}

function escalationLevel(anomalies) {
  const total = anomalyCount(anomalies);
  if (total === 0) return 'none';
  const lastEmpty = anomalies.emptyTurns.length > 0;
  if (total > 5 || lastEmpty) return 'error';
  if (total > 2 || anomalies.missingResults.length > 1) return 'warning';
  return 'info';
}

function formatNotice(anomalies, fixed) {
  const parts = [];
  if (anomalies.orphanResults.length) parts.push(`${anomalies.orphanResults.length} orphan tool_result dropped`);
  if (anomalies.missingResults.length) parts.push(`${anomalies.missingResults.length} missing tool_result stubbed`);
  if (anomalies.duplicateIds.length) parts.push(`${anomalies.duplicateIds.length} duplicate ID renamed`);
  if (anomalies.emptyTurns.length) parts.push(`${anomalies.emptyTurns.length} empty turn filled`);
  return `transcript: fixed ${fixed} anomalies (${parts.join(', ')})`;
}

module.exports = {
  PLACEHOLDER_TEXT,
  STUB_RESULT_TEXT,
  findAnomalies,
  hasAnomalies,
  anomalyCount,
  fixAnomalies,
  escalationLevel,
  formatNotice,
};
