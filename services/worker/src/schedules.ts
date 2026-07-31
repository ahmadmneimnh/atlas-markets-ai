import { JOB, QUEUE } from '@atlas/core';

import { getQueue } from './queues';
import { logger } from './lib/logger';

/**
 * Repeatable jobs.
 *
 * Cadences are set by how fast the underlying datum actually changes, not by
 * what feels responsive. Refreshing fundamentals every minute burns the provider
 * quota that quotes need, to re-fetch a number that moves once a quarter.
 *
 * Registration is idempotent — BullMQ keys a repeatable job by name + pattern,
 * so a redeploy replaces rather than duplicates. Changing a cron expression
 * leaves the old schedule orphaned in Redis, which is why `jobId` is pinned:
 * it makes the replacement explicit.
 */
interface Schedule {
  queue: (typeof QUEUE)[keyof typeof QUEUE];
  job: string;
  /** Cron in UTC. Markets are described in exchange-local time and converted. */
  pattern: string;
  data: Record<string, unknown>;
  note: string;
}

export const SCHEDULES: Schedule[] = [
  {
    queue: QUEUE.marketData,
    job: JOB.refreshQuotes,
    pattern: '*/2 * * * *',
    data: { force: false },
    note: 'Crypto trades continuously; equity quotes are stale outside session hours and the handler skips closed venues.',
  },
  {
    queue: QUEUE.marketData,
    job: JOB.refreshOhlcv,
    pattern: '5 * * * *',
    data: { force: false },
    note: 'Daily candles change once per session. Hourly is already generous; it exists to catch late corrections.',
  },
  {
    queue: QUEUE.marketData,
    job: JOB.ingestNews,
    pattern: '*/15 * * * *',
    data: { force: false },
    note: 'News APIs bill per call and the news factor reads a rolling window, not the last minute.',
  },
  {
    queue: QUEUE.scoring,
    job: JOB.scoreUniverse,
    pattern: '10,40 * * * *',
    data: { kind: 'all' },
    note: 'Offset from the quote refresh so scoring reads data that has just landed rather than racing it.',
  },
  {
    queue: QUEUE.alerts,
    job: JOB.evaluateAlerts,
    pattern: '*/5 * * * *',
    data: {},
    note: 'Alert latency is a product promise. Five minutes is the floor that per-user rate limits allow.',
  },
];

export async function registerSchedules(): Promise<void> {
  for (const schedule of SCHEDULES) {
    await getQueue(schedule.queue).add(schedule.job, schedule.data, {
      repeat: { pattern: schedule.pattern, tz: 'UTC' },
      jobId: `schedule:${schedule.job}`,
    });
    logger.info('schedule registered', {
      queue: schedule.queue,
      job: schedule.job,
      pattern: schedule.pattern,
    });
  }
}
