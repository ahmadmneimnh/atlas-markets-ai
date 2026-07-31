import { Worker, type Job } from 'bullmq';
import { QUEUE, QUEUE_PREFIX, type QueueName } from '@atlas/core';

import { env } from './lib/env';
import { logger } from './lib/logger';
import { closeConnections, consumerConnection } from './lib/redis';
import { resolveHandler } from './jobs';
import { closeQueues } from './queues';
import { registerSchedules } from './schedules';

/**
 * Worker entrypoint.
 *
 * One `Worker` per queue rather than one across all of them: concurrency is a
 * per-queue property. Notification delivery can run twenty at a time; market-data
 * refresh is bounded by a provider's requests-per-minute and must not be.
 */
const workers: Worker[] = [];

function startWorker(name: QueueName, concurrency: number): Worker {
  const worker = new Worker(name, async (job: Job) => resolveHandler(name, job.name)(job), {
    connection: consumerConnection,
    prefix: QUEUE_PREFIX,
    concurrency,
  });

  // 'failed' fires for every attempt, including ones that will be retried. The
  // handler already logs the throw; this catches failures raised by BullMQ
  // itself — stalled jobs, lock loss — which no handler ever sees.
  worker.on('failed', (job, error) => {
    logger.warn('job attempt failed', {
      queue: name,
      job: job?.name,
      id: job?.id,
      attempt: job?.attemptsMade,
      error,
    });
  });

  worker.on('error', (error) => logger.error('worker error', { queue: name, error }));

  workers.push(worker);
  logger.info('worker started', { queue: name, concurrency });
  return worker;
}

async function main(): Promise<void> {
  logger.info('atlas worker booting', {
    nodeEnv: env.NODE_ENV,
    concurrency: env.WORKER_CONCURRENCY,
    schedules: env.WORKER_SCHEDULES_ENABLED,
  });

  startWorker(QUEUE.marketData, env.WORKER_CONCURRENCY);
  startWorker(QUEUE.scoring, env.WORKER_CONCURRENCY);
  startWorker(QUEUE.alerts, 1); // Alert evaluation reads a consistent snapshot; parallel sweeps double-fire.
  startWorker(QUEUE.notifications, env.WORKER_CONCURRENCY * 4);

  if (env.WORKER_SCHEDULES_ENABLED) {
    await registerSchedules();
  } else {
    logger.warn('schedules disabled by WORKER_SCHEDULES_ENABLED=false');
  }
}

/**
 * Graceful shutdown.
 *
 * `worker.close()` waits for in-flight jobs to finish before releasing their
 * locks. Killing the process instead leaves jobs locked until BullMQ's stall
 * timeout expires — thirty seconds during which a redeployed worker will not
 * pick them up, and after which they are retried even though they completed.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

  const timeout = setTimeout(() => {
    logger.error('graceful shutdown timed out; exiting');
    process.exit(1);
  }, 30_000);
  timeout.unref();

  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await closeConnections();

  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// An unhandled rejection has already skipped its error path. Exiting lets the
// supervisor restart into a known state instead of continuing in an unknown one.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { error: reason });
  void shutdown('unhandledRejection');
});

main().catch((error: unknown) => {
  logger.error('worker failed to start', { error });
  process.exit(1);
});
