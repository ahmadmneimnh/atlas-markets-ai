import { logger } from '../lib/logger';

/**
 * Notification channels.
 *
 * Each channel is a function from a message to a `DeliveryResult`. Three rules
 * hold across all of them:
 *
 * 1. **A channel never throws for a delivery failure.** It returns
 *    `{ ok: false, retryable }`, because the caller has to decide between
 *    retrying and marking permanently failed, and an exception loses that
 *    distinction. A malformed webhook URL will never succeed; a 503 from Discord
 *    will.
 *
 * 2. **An unconfigured channel is `not_configured`, never a silent success.**
 *    Returning success for a channel that sent nothing produces a delivery log
 *    saying the user was told, when they were not.
 *
 * 3. **Nothing user-supplied is interpolated into markup.** Telegram and Discord
 *    both parse formatting in message bodies, and an asset name is not trusted
 *    input — it comes from a provider.
 */

export type ChannelId = 'IN_APP' | 'EMAIL' | 'PUSH' | 'TELEGRAM' | 'DISCORD' | 'WEBHOOK' | 'SMS';

export interface NotificationMessage {
  title: string;
  body: string;
  /** Absolute URL back into the app. */
  link?: string;
  symbol: string;
  /** The evaluator's reason. Shown verbatim — it is the evidence. */
  reason: string;
}

export interface Recipient {
  userId: string;
  email?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  webhookUrl?: string;
  pushSubscription?: string;
}

export type DeliveryResult =
  { ok: true; detail?: string } | { ok: false; retryable: boolean; error: string };

const failure = (error: string, retryable: boolean): DeliveryResult => ({
  ok: false,
  retryable,
  error,
});

/**
 * HTTP status → retryable.
 *
 * 4xx other than 408/429 means the request itself is wrong and will be wrong
 * forever; retrying it five times just delays the inevitable and burns quota.
 */
function retryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

async function postJson(url: string, body: unknown, timeoutMs = 10_000): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return failure(
        `HTTP ${response.status}: ${text.slice(0, 200)}`,
        retryableStatus(response.status),
      );
    }
    return { ok: true };
  } catch (error) {
    // A timeout or a DNS blip is worth retrying; the caller decides how often.
    return failure(error instanceof Error ? error.message : String(error), true);
  } finally {
    clearTimeout(timer);
  }
}

/** Escapes Telegram MarkdownV2's reserved characters. */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (match) => `\\${match}`);
}

export const channels: Record<
  Exclude<ChannelId, 'IN_APP'>,
  (message: NotificationMessage, recipient: Recipient) => Promise<DeliveryResult>
> = {
  async EMAIL(message, recipient) {
    const host = process.env.EMAIL_SERVER_HOST;
    const from = process.env.EMAIL_FROM;
    if (!host || !from) return failure('not_configured: EMAIL_SERVER_HOST/EMAIL_FROM unset', false);
    if (!recipient.email) return failure('not_configured: recipient has no email address', false);

    // Imported lazily so the worker starts without nodemailer present, and so an
    // email-less deployment never pays for the module.
    const nodemailer = await import('nodemailer').catch(() => null);
    if (!nodemailer) return failure('not_configured: nodemailer is not installed', false);

    try {
      const transport = nodemailer.default.createTransport({
        host,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth:
          process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
            ? { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD }
            : undefined,
      });

      await transport.sendMail({
        from,
        to: recipient.email,
        subject: message.title,
        // Plain text only. An HTML email that interpolates a provider-supplied
        // headline is an injection surface for no benefit an alert needs.
        text: `${message.body}\n\n${message.reason}\n\n${message.link ?? ''}`.trim(),
      });
      return { ok: true };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error), true);
    }
  },

  async TELEGRAM(message, recipient) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return failure('not_configured: TELEGRAM_BOT_TOKEN unset', false);
    if (!recipient.telegramChatId) {
      return failure('not_configured: recipient has no Telegram chat id', false);
    }

    const text = [
      `*${escapeMarkdownV2(message.title)}*`,
      escapeMarkdownV2(message.body),
      `_${escapeMarkdownV2(message.reason)}_`,
      message.link ? escapeMarkdownV2(message.link) : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: recipient.telegramChatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
  },

  async DISCORD(message, recipient) {
    const url = recipient.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL;
    if (!url) return failure('not_configured: no Discord webhook URL', false);

    return postJson(url, {
      // `content` is left empty and everything goes in an embed: Discord parses
      // markdown and mentions in `content`, so `@everyone` in a headline would
      // ping a server.
      content: '',
      embeds: [
        {
          title: message.title.slice(0, 256),
          description: `${message.body}\n\n${message.reason}`.slice(0, 4096),
          url: message.link,
          color: 0xd4af37,
          footer: { text: `Atlas Markets AI · ${message.symbol}` },
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    });
  },

  async WEBHOOK(message, recipient) {
    if (!recipient.webhookUrl)
      return failure('not_configured: recipient has no webhook URL', false);

    let parsed: URL;
    try {
      parsed = new URL(recipient.webhookUrl);
    } catch {
      return failure('invalid webhook URL', false);
    }

    // SSRF guard. A user-supplied webhook that resolves to localhost or a
    // link-local address turns this worker into a proxy for whatever is on the
    // internal network — the cloud metadata endpoint most of all.
    if (parsed.protocol !== 'https:') {
      return failure('webhook must use https', false);
    }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(parsed.hostname)) {
      return failure('webhook host is not routable from this service', false);
    }

    return postJson(recipient.webhookUrl, {
      type: 'atlas.alert',
      symbol: message.symbol,
      title: message.title,
      body: message.body,
      reason: message.reason,
      link: message.link,
      firedAt: new Date().toISOString(),
    });
  },

  async PUSH(_message, recipient) {
    if (!recipient.pushSubscription) {
      return failure('not_configured: recipient has no push subscription', false);
    }
    if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) {
      return failure('not_configured: VAPID keys unset', false);
    }
    // Web push needs a signed VAPID JWT and an encrypted payload; the `web-push`
    // dependency is not installed, so this reports not_configured rather than
    // pretending to send. Marked non-retryable because retrying changes nothing.
    logger.warn('push channel not implemented', { userId: recipient.userId });
    return failure('not_configured: web push is not wired up yet (Phase 8 follow-up)', false);
  },

  async SMS(_message, recipient) {
    logger.warn('sms channel not implemented', { userId: recipient.userId });
    return failure('not_configured: no SMS provider is configured', false);
  },
};
