import "dotenv/config";
import { drainOnce, waitForIdle } from "./server/job-handlers";
import { log } from "./lib/logger";

const workerId = `worker-${process.pid}`;
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("worker shutting down", { workerId, signal });
  const drained = await waitForIdle(25_000);
  log.info("worker stopped", { workerId, drained });
  process.exit(drained ? 0 : 1);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function loop() {
  log.info("worker started", { workerId });
  while (!stopping) {
    const n = await drainOnce(workerId);
    if (stopping) break;
    if (n === 0) await new Promise((r) => setTimeout(r, 2000));
  }
}

loop().catch((e) => {
  log.error("worker crashed", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
