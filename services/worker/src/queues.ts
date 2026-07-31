import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE, QUEUE_PREFIX, type QueueName } from '@atlas/core';

import { producerConnection } from './lib/redis';

/**
 * Producer-side queue handles.
 *
 * Constructed lazily and memoised: instantiating a `Queue` opens Redis
 * bookkeeping keys, and a module that eagerly builds all four means importing
 * any one of them from a script (a migration, a CLI backfill) creates all four.
 */
const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: producerConnection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queues.set(name, queue);
  return queue;
}

export const marketDataQueue = () => getQueue(QUEUE.marketData);
export const scoringQueue = () => getQueue(QUEUE.scoring);
export const alertsQueue = () => getQueue(QUEUE.alerts);
export const notificationsQueue = () => getQueue(QUEUE.notifications);

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
}
