export async function runCronIteration({
  at = new Date(),
  runScheduler,
  recordFailure,
  processJobs
} = {}) {
  let schedulerErrorCode = "";
  try {
    await runScheduler(at);
  } catch (error) {
    schedulerErrorCode = String(await recordFailure(at, error) || "scheduler_tick_error");
  }
  const jobs = await processJobs(at);
  return { schedulerErrorCode, jobs };
}
