import type { Job } from 'bullmq';
import { JOB, QUEUE, evaluateRule, type AlertRule, type MarketSnapshot } from '@atlas/core';
import { isDatabaseConfigured, prisma } from '@atlas/db';

import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { getQueue } from '../queues';

/**
 * The alert evaluation sweep.
 *
 * Reads enabled alerts, asks the BFF for each asset's current state, evaluates
 * every rule, and fans firing alerts out to their channels.
 *
 * Market data is fetched **through the BFF's scoring API** rather than by
 * calling providers here. The rate limiters, circuit breakers and API keys all
 * live in one place; a second process calling the same vendors would double the
 * effective request rate against limits neither side can see.
 */
interface ScoreApiResponse {
  score: number;
  recommendation: string;
  quote?: { price: number; changePercent: number };
  breakdown?: { factor: string; signals: { label: string; value: string }[] }[];
}

/** Pulls a numeric reading out of the API's cited signals. */
function signalValue(response: ScoreApiResponse, fragment: string): number | undefined {
  for (const factor of response.breakdown ?? []) {
    for (const signal of factor.signals) {
      if (signal.label.toLowerCase().includes(fragment)) {
        const match = /-?\d+(\.\d+)?/.exec(signal.value);
        if (!match) return undefined;
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
    }
  }
  return undefined;
}

async function fetchSnapshot(
  symbol: string,
  kind: string,
  previous: { recommendation?: string | null },
): Promise<MarketSnapshot | null> {
  const url = `${env.ATLAS_API_URL}/api/score/${kind}/${encodeURIComponent(symbol)}`;

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });

    // 422 means the engine declined to score for lack of coverage. That is a
    // successful, meaningful answer — but it carries no readings, so every rule
    // against it is undetermined rather than false.
    if (!response.ok) {
      logger.info('snapshot unavailable', { symbol, status: response.status });
      return null;
    }

    const data = (await response.json()) as ScoreApiResponse;

    const snapshot: MarketSnapshot = {};
    if (data.quote) {
      snapshot.price = data.quote.price;
      snapshot.changePercent = data.quote.changePercent;
    }
    snapshot.recommendation = data.recommendation;
    if (previous.recommendation) snapshot.previousRecommendation = previous.recommendation;

    const rsi = signalValue(data, 'rsi');
    const volume = signalValue(data, 'volume vs 20-bar average');
    if (rsi !== undefined) snapshot.rsi = rsi;
    if (volume !== undefined) snapshot.volumeRatio = volume;

    return snapshot;
  } catch (error) {
    logger.warn('snapshot fetch failed', { symbol, error });
    return null;
  }
}

/**
 * Loads the alerts due for evaluation.
 *
 * Prisma's connection errors arrive as a multi-line block containing the failing
 * query and its surrounding source. That is excellent in a terminal and wrong in
 * a structured log: it lands as one enormous `message` field on a job that runs
 * every five minutes, so a single misconfigured DATABASE_URL buries every other
 * line in the log.
 *
 * A connection failure is still thrown — it is genuinely retryable, and BullMQ's
 * backoff is the right response — but as one sentence naming the host. Anything
 * that is not a connection error passes through untouched, because that would be
 * a real bug and its detail is worth having.
 */
async function findAlerts(asset?: { symbol: string; kind: string }) {
  try {
    return await prisma.alert.findMany({
      where: {
        enabled: true,
        ...(asset ? { asset: { symbol: asset.symbol } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        asset: { select: { symbol: true, kind: true, name: true } },
        user: { select: { id: true, email: true } },
      },
    });
  } catch (error) {
    // Matched on the error class, not a code: a connection failure surfaces as
    // PrismaClientInitializationError with `code` and `errorCode` both
    // undefined, so a code check silently never fires. The P100x codes below
    // cover the cases that do arrive as known request errors.
    const name = (error as { name?: string } | null)?.name;
    const code = (error as { code?: string } | null)?.code;
    const isConnectionFailure =
      name === 'PrismaClientInitializationError' ||
      code === 'P1001' ||
      code === 'P1002' ||
      code === 'P1017';

    if (isConnectionFailure) {
      logger.warn('alert sweep: database unreachable', { name, code });
      throw new Error('Database unreachable; the sweep will retry with backoff.');
    }
    throw error;
  }
}

export async function evaluateAlerts(job: Job): Promise<{ evaluated: number; fired: number }> {
  if (!isDatabaseConfigured) {
    logger.warn('alert sweep skipped: no DATABASE_URL configured');
    return { evaluated: 0, fired: 0 };
  }

  const { asset } = job.data as { asset?: { symbol: string; kind: string } };

  const alerts = await findAlerts(asset);

  // Grouped by asset so one price fetch serves every rule on it. Fetching per
  // alert would multiply provider load by however many rules a popular asset has.
  const byAsset = new Map<string, typeof alerts>();
  for (const alert of alerts) {
    const key = `${alert.asset.kind}:${alert.asset.symbol}`;
    const bucket = byAsset.get(key);
    if (bucket) bucket.push(alert);
    else byAsset.set(key, [alert]);
  }

  let fired = 0;
  const now = new Date();

  for (const [key, group] of byAsset) {
    const first = group[0];
    if (!first) continue;

    const kind = first.asset.kind === 'CRYPTO' ? 'crypto' : 'equity';

    const lastRecommendation = await prisma.aiRecommendation.findFirst({
      where: { asset: { symbol: first.asset.symbol } },
      orderBy: { computedAt: 'desc' },
      select: { recommendation: true },
      skip: 1,
    });

    const snapshot = await fetchSnapshot(first.asset.symbol, kind, {
      recommendation: lastRecommendation?.recommendation ?? null,
    });

    if (!snapshot) {
      logger.info('alerts undetermined for asset', { key, count: group.length });
      continue;
    }

    for (const alert of group) {
      const rule: AlertRule = {
        id: alert.id,
        type: alert.type,
        params: (alert.params ?? {}) as Record<string, unknown>,
        cooldownMinutes: alert.cooldownMinutes,
        lastFiredAt: alert.lastFiredAt,
        enabled: alert.enabled,
      };

      const decision = evaluateRule(rule, snapshot, now);

      if (decision.status !== 'fire') {
        // Logged at debug: an undetermined rule is worth knowing about in
        // aggregate, but one line per rule per sweep would drown the log.
        logger.debug('alert not fired', {
          alertId: alert.id,
          status: decision.status,
          reason: decision.reason,
        });
        continue;
      }

      fired += 1;

      const title = `${alert.asset.symbol}: ${alert.type.replace(/_/g, ' ').toLowerCase()}`;
      const message = {
        title,
        body: `${alert.asset.name} (${alert.asset.symbol})`,
        link: `${env.ATLAS_API_URL}/asset/${kind}/${alert.asset.symbol}`,
        symbol: alert.asset.symbol,
        reason: decision.reason,
      };

      /**
       * The inbox row, the per-channel delivery rows and the cooldown stamp are
       * written in one transaction.
       *
       * Without it, a crash between them either re-fires the alert on the next
       * sweep (lastFiredAt never written) or leaves a notification with no
       * delivery record to retry from.
       */
      await prisma.$transaction(async (tx) => {
        await tx.notification.create({
          data: {
            userId: alert.userId,
            type: 'ALERT_TRIGGERED',
            title,
            body: decision.reason,
            link: `/asset/${kind}/${alert.asset.symbol}`,
            data: { alertId: alert.id, symbol: alert.asset.symbol },
          },
        });

        for (const channel of alert.channels) {
          if (channel === 'IN_APP') continue; // Already written above.
          await tx.alertDelivery.create({
            data: { alertId: alert.id, channel, payload: message },
          });
        }

        await tx.alert.update({
          where: { id: alert.id },
          data: { lastFiredAt: now, triggerCount: { increment: 1 } },
        });
      });

      // Enqueued after the transaction commits. Enqueuing inside it would let a
      // worker pick the job up and deliver a notification for a transaction that
      // then rolls back.
      for (const channel of alert.channels) {
        if (channel === 'IN_APP') continue;
        await getQueue(QUEUE.notifications).add(JOB.deliverNotification, {
          alertId: alert.id,
          channel,
          message,
          recipient: {
            userId: alert.user.id,
            ...(alert.user.email ? { email: alert.user.email } : {}),
          },
        });
      }
    }
  }

  return { evaluated: alerts.length, fired };
}
