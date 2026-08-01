import { prisma } from '@atlas/db';

import { Card, SectionTitle } from '@/components/primitives';
import { QUEUE } from '@atlas/core';
import { env } from '@/lib/env';

/**
 * The administrative console.
 *
 * A server component that reads directly rather than fetching its own API
 * routes: it already runs on the server with the session resolved, so an HTTP
 * round trip back into the same process would add latency and a second place for
 * the authorisation check to be wrong. The API routes exist for programmatic
 * use and for the mutations, which do go through them.
 */

async function queueDepths(): Promise<
  { queue: string; waiting: number; failed: number }[] | { error: string }
> {
  if (!env.redisUrl) {
    return { error: 'REDIS_URL is not set, so the worker is not running and has no queues.' };
  }

  try {
    const { default: IORedis } = await import('ioredis');
    const connection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 2_000,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    try {
      await connection.connect();
      return await Promise.all(
        Object.values(QUEUE).map(async (queue) => ({
          queue,
          waiting: await connection.llen(`atlas:${queue}:wait`),
          failed: await connection.zcard(`atlas:${queue}:failed`),
        })),
      );
    } finally {
      await connection.quit().catch(() => connection.disconnect());
    }
  } catch (error) {
    // Reported as data on an ops page. An unreachable Redis is an operational
    // fact worth seeing, not a 500 that hides the rest of the console.
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function AdminConsole() {
  const [users, flags, audit, queues] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      // Explicit select: sessions, OAuth tokens and API key hashes all hang off
      // this model and none of them belong on a page.
      select: {
        id: true,
        email: true,
        role: true,
        bannedAt: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { actor: { select: { email: true } } },
    }),
    queueDepths(),
  ]);

  return (
    <>
      <section>
        <SectionTitle hint={`${users.length} most recent`}>Users</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-glass-border/60 text-left">
                {['Email', 'Role', 'Status', 'Last login'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium text-ink-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-glass-border/30 last:border-0">
                  <td className="px-4 py-3 text-ink">{u.email}</td>
                  <td className="px-4 py-3 text-ink-muted">{u.role}</td>
                  <td className="px-4 py-3">
                    {u.bannedAt ? (
                      <span className="text-bear">suspended</span>
                    ) : (
                      <span className="text-bull">active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-faint">
                    {u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : 'never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-ink-faint">
            Role changes and suspensions go through PATCH /api/admin/users, which enforces the
            last-administrator guard and writes an audit record in the same transaction.
          </p>
        </Card>
      </section>

      <section>
        <SectionTitle hint="rollout is null when ungated, 0 when enabled for nobody">
          Feature flags
        </SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {flags.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              No flags yet — run <code className="text-gold">npm run db:seed</code>.
            </p>
          ) : (
            flags.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm text-ink">{flag.key}</p>
                  <p className="text-xs text-ink-faint">{flag.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-sm ${flag.enabled ? 'text-bull' : 'text-ink-muted'}`}>
                    {flag.enabled ? 'on' : 'off'}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {flag.rolloutPct === null ? 'no % gate' : `${flag.rolloutPct}%`}
                  </p>
                </div>
              </div>
            ))
          )}
        </Card>
      </section>

      <section>
        <SectionTitle hint="live from Redis">Queues</SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {'error' in queues ? (
            <p className="px-4 py-6 text-sm text-ink-muted">{queues.error}</p>
          ) : (
            queues.map((q) => (
              <div key={q.queue} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ink">{q.queue}</span>
                <span className="text-xs text-ink-faint">
                  <span className="tnum text-ink-muted">{q.waiting}</span> waiting ·{' '}
                  <span className={`tnum ${q.failed > 0 ? 'text-bear' : 'text-ink-muted'}`}>
                    {q.failed}
                  </span>{' '}
                  failed
                </span>
              </div>
            ))
          )}
        </Card>
      </section>

      <section>
        <SectionTitle hint="read-only — there is no delete endpoint">Audit log</SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {audit.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">No administrative actions recorded.</p>
          ) : (
            audit.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <p className="text-sm text-ink">
                  <span className="text-gold">{entry.action}</span> on {entry.target}
                </p>
                <p className="text-xs text-ink-faint">
                  {entry.actor?.email ?? 'deleted account'} ·{' '}
                  {entry.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                </p>
              </div>
            ))
          )}
        </Card>
      </section>
    </>
  );
}
