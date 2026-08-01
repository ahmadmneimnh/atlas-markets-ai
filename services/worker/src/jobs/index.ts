import { UnrecoverableError, type Job } from 'bullmq';
import { JOB, JOB_PAYLOADS, QUEUE, type QueueName } from '@atlas/core';

import { logger } from '../lib/logger';
import { deliverNotification } from './notifications';
import { evaluateAlerts } from './alerts';

export type JobHandler = (job: Job) => Promise<unknown>;

/**
 * Phase 1 ships the pipeline, not the pipework's contents.
 *
 * Every handler below validates its payload and then refuses, loudly, with the
 * phase that will implement it. The refusal uses `UnrecoverableError` so BullMQ
 * fails it once instead of burning five exponential-backoff attempts on
 * something that cannot succeed — and so the admin panel's failed-jobs view
 * shows the real reason rather than "attempt 5/5".
 *
 * The tempting alternative was a handler that returns `{ ok: true }` and does
 * nothing. That produces a green queue dashboard for a system that is doing no
 * work, which is strictly worse than a red one.
 */
function notImplemented(phase: string): JobHandler {
  return async (job: Job) => {
    throw new UnrecoverableError(
      `${job.name}: not implemented until ${phase}. The queue, payload contract and retry policy are wired; the body is not.`,
    );
  };
}

/**
 * Payload validation happens here rather than inside each handler.
 *
 * A job's payload survives a deploy in Redis. When the producer's schema changes
 * and the consumer rolls forward, the old payloads still arrive — parsing at the
 * boundary turns that into one clear validation failure instead of an undefined
 * read somewhere three calls deep.
 */
export function withValidation(name: string, handler: JobHandler): JobHandler {
  const schema = JOB_PAYLOADS[name as keyof typeof JOB_PAYLOADS];

  return async (job: Job) => {
    if (schema) {
      const parsed = schema.safeParse(job.data);
      if (!parsed.success) {
        throw new UnrecoverableError(
          `${name}: payload failed validation — ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
        );
      }
      job.data = parsed.data;
    }

    const startedAt = Date.now();
    logger.info('job started', { queue: job.queueName, job: name, id: job.id });

    try {
      const result = await handler(job);
      logger.info('job finished', {
        queue: job.queueName,
        job: name,
        id: job.id,
        ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error('job failed', {
        queue: job.queueName,
        job: name,
        id: job.id,
        ms: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };
}

/** Queue → job name → handler. A job name absent from its queue's map is rejected. */
export const HANDLERS: Record<QueueName, Record<string, JobHandler>> = {
  [QUEUE.marketData]: {
    [JOB.refreshQuotes]: notImplemented('Phase 3'),
    [JOB.refreshOhlcv]: notImplemented('Phase 3'),
    [JOB.ingestNews]: notImplemented('Phase 3'),
  },
  [QUEUE.scoring]: {
    [JOB.scoreAsset]: notImplemented('Phase 4'),
    [JOB.scoreUniverse]: notImplemented('Phase 4'),
  },
  [QUEUE.alerts]: {
    [JOB.evaluateAlerts]: evaluateAlerts,
  },
  [QUEUE.notifications]: {
    [JOB.deliverNotification]: deliverNotification,
  },
};

export function resolveHandler(queue: QueueName, jobName: string): JobHandler {
  const handler = HANDLERS[queue]?.[jobName];
  if (!handler) {
    return async () => {
      throw new UnrecoverableError(`${queue}: no handler registered for job "${jobName}"`);
    };
  }
  return withValidation(jobName, handler);
}
