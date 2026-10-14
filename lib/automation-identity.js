'use strict';

function enrichAutomation(msg) {
  if (msg.automation_provider || msg.automation_name) {
    msg.automation = { id: msg.automation_id || null, name: msg.automation_name, provider: msg.automation_provider };
  } else {
    msg.automation = null;
  }
  delete msg.automation_id;
  delete msg.automation_name;
  delete msg.automation_provider;
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
