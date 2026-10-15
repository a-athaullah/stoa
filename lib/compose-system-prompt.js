function composeSystemPrompt(base, agentPrompt, roomPrompt) {
  const parts = [base];
  if (agentPrompt) parts.push(agentPrompt);
  if (roomPrompt) parts.push(roomPrompt);
  return parts.join('\n\n---\n\n');
}

module.exports = { composeSystemPrompt };
