import { UnrecoverableError, type Job } from 'bullmq';

import { channels, type ChannelId, type NotificationMessage, type Recipient } from '../channels';
import { logger } from '../lib/logger';

/**
 * Delivers one notification on one channel.
 *
 * One job per channel per firing, which is why `AlertDelivery` has a row per
 * channel: a Telegram outage must not mark the email as sent, and a retry must
 * re-attempt only the channel that failed.
 *
 * The distinction the channels return — retryable vs not — is honoured here.
 * `UnrecoverableError` tells BullMQ to fail once instead of burning five
 * exponential-backoff attempts on a malformed webhook URL that will never work.
 */
export interface DeliverPayload {
  channel: ChannelId;
  message: NotificationMessage;
  recipient: Recipient;
}

export async function deliverNotification(job: Job): Promise<{ delivered: boolean }> {
  const { channel, message, recipient } = job.data as DeliverPayload;

  if (channel === 'IN_APP') {
    // The in-app inbox is a database row written by the alert evaluator, not an
    // outbound send. Reaching here means a payload was built wrong.
    throw new UnrecoverableError('IN_APP notifications are written directly, not queued.');
  }

  const send = channels[channel];
  if (!send) throw new UnrecoverableError(`No dispatcher for channel ${channel}.`);

  const result = await send(message, recipient);

  if (result.ok) {
    logger.info('notification delivered', { channel, symbol: message.symbol });
    return { delivered: true };
  }

  logger.warn('notification failed', {
    channel,
    symbol: message.symbol,
    error: result.error,
    retryable: result.retryable,
  });

  if (!result.retryable) {
    throw new UnrecoverableError(`${channel}: ${result.error}`);
  }
  // A plain throw is retryable under the queue's exponential backoff.
  throw new Error(`${channel}: ${result.error}`);
}
