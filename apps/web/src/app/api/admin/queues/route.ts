import { NextResponse } from 'next/server';
import { QUEUE, QUEUE_PREFIX } from '@atlas/core';

import { requirePermission } from '@/lib/auth';
import { handleApiError } from '@/lib/api/respond';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Queue depth and job counts, read straight from Redis.
 *
 * Deliberately **not** by importing BullMQ into the web app. The app would then
 * carry a queue library it never produces or consumes with, and — more to the
 * point — instantiating a `Queue` writes Redis bookkeeping keys, so an admin
 * page load would mutate the very state it is reporting on.
 *
 * Instead the counts come from `LLEN`/`ZCARD` on BullMQ's own key layout, which
 * is stable and documented: `{prefix}:{queue}:wait`, `:active`, `:delayed`,
 * `:failed`, `:completed`.
 */
interface QueueDepth {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

async function readDepths(): Promise<QueueDepth[]> {
  // ioredis is a worker dependency, imported lazily so the web app does not pay
  // for it on any other route and starts fine when it is absent.
  const { default: IORedis } = await import('ioredis');

  const connection = new IORedis(env.redisUrl ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    // Short and finite: an admin page must render an error quickly rather than
    // hang while ioredis retries a Redis that is not there.
    connectTimeout: 2_000,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  try {
    await connection.connect();

    const depths = await Promise.all(
      Object.values(QUEUE).map(async (queue): Promise<QueueDepth> => {
        const key = (suffix: string) => `${QUEUE_PREFIX}:${queue}:${suffix}`;
        const [waiting, active, delayed, failed, completed] = await Promise.all([
          connection.llen(key('wait')),
          connection.llen(key('active')),
          connection.zcard(key('delayed')),
          connection.zcard(key('failed')),
          connection.zcard(key('completed')),
        ]);
        return { queue, waiting, active, delayed, failed, completed };
      }),
    );

    return depths;
  } finally {
    // `quit` rather than `disconnect`, and in a finally: a leaked connection per
    // page load exhausts Redis' client limit within an afternoon of refreshing.
    await connection.quit().catch(() => connection.disconnect());
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    await requirePermission('admin:queues');

    if (!env.redisUrl) {
      return NextResponse.json({
        available: false,
        reason:
          'REDIS_URL is not set. Queue depth is read from Redis; without it the worker is not running either.',
        queues: [],
      });
    }

    const queues = await readDepths();
    return NextResponse.json({ available: true, queues });
  } catch (error) {
    // A Redis that is configured but unreachable is an operational fact worth
    // reporting as data on an ops page, not a 500 that hides which queues exist.
    if (
      error instanceof Error &&
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection is closed/.test(error.message)
    ) {
      return NextResponse.json({
        available: false,
        reason: `Redis is configured but unreachable: ${error.message}`,
        queues: [],
      });
    }
    return handleApiError(error, 'GET /api/admin/queues');
  }
}
