export function clientAutonomyHealthy(client = {}) {
  const agentsFresh = client?.allAgentsFresh === undefined
    ? client?.allAgentsSeen === true
    : client?.allAgentsFresh === true;
  return Boolean(
    client?.allAgentsSeen === true &&
    agentsFresh &&
    client?.cycleHealth?.status === "success" &&
    client?.cycleHealth?.delayed !== true
  );
}

export function autonomyOverallHealthy({ schedulerHealthy = false, clients = [] } = {}) {
  return Boolean(
    schedulerHealthy === true &&
    Array.isArray(clients) &&
    clients.length > 0 &&
    clients.every(clientAutonomyHealthy)
  );
}
