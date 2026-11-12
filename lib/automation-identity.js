'use strict';

// provider 'task' (task board runner): the card rides along as task_id (null once the card is deleted)
// and task_seq (snapshot, the "Task #seq" badge).
function enrichAutomation(msg) {
  if (msg.automation_provider || msg.automation_name) {
    msg.automation = { id: msg.automation_id || null, name: msg.automation_name, provider: msg.automation_provider };
    if (msg.automation_provider === 'task') {
      msg.automation.task_id = msg.task_id ?? null;
      msg.automation.task_seq = msg.task_seq ?? null;
    }
  } else {
    msg.automation = null;
  }
  delete msg.automation_id;
  delete msg.automation_name;
  delete msg.automation_provider;
  delete msg.task_id;
  delete msg.task_seq;
  return msg;
}

function enrichAutomationList(rows) {
  for (const r of rows) enrichAutomation(r);
  return rows;
}

function watchReplyAutomation(rootRow) {
  if (rootRow.automation_provider) {
    return { id: rootRow.automation_id || null, name: rootRow.automation_name, provider: rootRow.automation_provider };
  }
  return { id: null, name: 'Slack', provider: 'slack' };
}

module.exports = { enrichAutomation, enrichAutomationList, watchReplyAutomation };
