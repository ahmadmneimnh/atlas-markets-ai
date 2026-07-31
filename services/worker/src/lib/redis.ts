import IORedis from 'ioredis';

import { env } from './env';
import { logger } from './logger';

/**
 * The Redis connection BullMQ runs on.
 *
 * `maxRetriesPerRequest: null` is mandatory, not a preference: BullMQ's blocking
 * commands (`BRPOPLPUSH`) sit open for tens of seconds, and ioredis' default of
 * 20 retries makes it abort a healthy blocking read and throw. BullMQ refuses to
 * start without this set.
 *
 * `enableReadyCheck: false` keeps the worker from crashing against managed Redis
 * providers that block the `INFO` command.
 */
function createConnection(name: string): IORedis {
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectionName: `atlas-${name}`,
    // Full jitter on reconnect. Without it, every worker in a fleet reconnects
    // on the same schedule after a Redis restart and stampedes it back down.
    retryStrategy: (attempt) => Math.min(Math.random() * 2 ** attempt * 50, 10_000),
  });

  connection.on('error', (error: Error) => logger.error('redis error', { name, error }));
  connection.on('reconnecting', () => logger.warn('redis reconnecting', { name }));

  return connection;
}

/**
 * Queues (producers) and Workers (consumers) get separate connections on
 * purpose: a Worker's blocking read occupies its connection, so sharing one
 * would stall every enqueue behind it.
 */
export const producerConnection = createConnection('producer');
export const consumerConnection = createConnection('consumer');

export async function closeConnections(): Promise<void> {
  await Promise.allSettled([producerConnection.quit(), consumerConnection.quit()]);
}
