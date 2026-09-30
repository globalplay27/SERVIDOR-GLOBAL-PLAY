export function clientAutonomyHealthy(client = {}) {
  return Boolean(
    client?.allAgentsSeen === true &&
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
