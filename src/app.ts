import { type Context, Hono } from 'hono';
import { renderServiceLandingPageHtml } from './dashboard.js';
import {
  parseInboundEmailPayload,
  parseTelegramBotToken,
  parseTelegramChatId,
  readRequestBodyFields,
} from './inbound-parser.js';
import {
  deliverEmailDocumentToTelegram,
  formatArchiveFilename,
  parseWebhookUrl,
  registerTelegramWebhook,
  resolveBotCommandResponse,
  sendTelegramTextMessage,
} from './telegram.js';
import type {
  TelegramUpdate,
  WebhookAppDependencies,
  WebhookEnvironment,
} from './types.js';

export function createInboundWebhookApp(dependencies: WebhookAppDependencies = {}): Hono {
  const application = new Hono({ strict: false });
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const currentTimestampProvider =
    dependencies.currentTimestampProvider ?? (() => new Date());

  const resolveEnvironment = (): WebhookEnvironment =>
    dependencies.environment ?? {
      BOT_TOKEN: process.env.BOT_TOKEN,
      CHAT_ID: process.env.CHAT_ID,
    };

  const handleInboundWebhook = async (context: Context): Promise<Response> => {
    const environment = resolveEnvironment();

    const routeChatIdParameter = context.req.param('chat_id');
    const candidateChatId =
      routeChatIdParameter && routeChatIdParameter.trim().length > 0
        ? routeChatIdParameter
        : environment.CHAT_ID;
    const targetChatId = parseTelegramChatId(candidateChatId);

    if (targetChatId === null) {
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const parsedBody = await readRequestBodyFields(context);
    if (parsedBody === null) {
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const emailPayload = await parseInboundEmailPayload(parsedBody);
    if (emailPayload === null) {
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const botToken = parseTelegramBotToken(environment.BOT_TOKEN);
    if (botToken === null) {
      return context.json({ message: 'Telegram bot token is not configured.' }, 500);
    }

    const currentTimestamp = currentTimestampProvider();
    const archiveFilename = formatArchiveFilename(currentTimestamp);
    const isDelivered = await deliverEmailDocumentToTelegram({
      botToken,
      chatId: targetChatId,
      emailPayload,
      archiveFilename,
      fetchImplementation,
    });

    if (!isDelivered) {
      return context.json(
        { message: 'Failed to deliver message to Telegram.' },
        502,
      );
    }

    return context.json({ status: 'ok' }, 200);
  };

  const handleRegisterWebhook = async (context: Context): Promise<Response> => {
    const environment = resolveEnvironment();
    const botToken = parseTelegramBotToken(environment.BOT_TOKEN);
    if (botToken === null) {
      return context.json(
        { ok: false, message: 'Telegram bot token is not configured.' },
        500,
      );
    }

    let candidateUrl: string | undefined;
    try {
      const parsedBody: unknown = await context.req.json();
      if (
        typeof parsedBody === 'object' &&
        parsedBody !== null &&
        'url' in parsedBody &&
        typeof (parsedBody as { url: unknown }).url === 'string'
      ) {
        candidateUrl = (parsedBody as { url: string }).url;
      }
    } catch {
      // Body may not be JSON
    }

    if (!candidateUrl) {
      candidateUrl = context.req.query('url');
    }

    const targetUrl = candidateUrl ?? context.req.url;
    const resolvedWebhookUrl = parseWebhookUrl(targetUrl);
    if (resolvedWebhookUrl === null) {
      return context.json({ ok: false, message: 'Invalid webhook URL.' }, 400);
    }

    const isRegistered = await registerTelegramWebhook({
      botToken,
      webhookUrl: resolvedWebhookUrl,
      fetchImplementation,
    });

    if (!isRegistered) {
      return context.json(
        { ok: false, message: 'Failed to register webhook with Telegram.' },
        502,
      );
    }

    return context.json(
      {
        ok: true,
        message: 'Webhook registered successfully.',
        url: resolvedWebhookUrl,
      },
      200,
    );
  };

  const handleTelegramWebhook = async (context: Context): Promise<Response> => {
    let update: TelegramUpdate;
    try {
      update = (await context.req.json()) as TelegramUpdate;
    } catch {
      return context.json({ message: 'Invalid JSON payload.' }, 400);
    }

    if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') {
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const message = update.message ?? update.channel_post ?? update.edited_message;
    if (!message || typeof message.text !== 'string' || !message.chat) {
      return context.json({ ok: true }, 200);
    }

    const commandResponseText = resolveBotCommandResponse(message.text);
    if (commandResponseText === null) {
      return context.json({ ok: true }, 200);
    }

    const environment = resolveEnvironment();
    const botToken = parseTelegramBotToken(environment.BOT_TOKEN);
    if (botToken === null) {
      return context.json(
        { message: 'Telegram bot token is not configured.' },
        500,
      );
    }

    const isSent = await sendTelegramTextMessage({
      botToken,
      chatId: message.chat.id,
      text: commandResponseText,
      fetchImplementation,
    });

    if (!isSent) {
      return context.json(
        { message: 'Failed to deliver message to Telegram.' },
        502,
      );
    }

    return context.json({ ok: true }, 200);
  };

  const renderLandingPage = (context: Context): Response => {
    return context.html(renderServiceLandingPageHtml(), 200);
  };

  application.get('/', renderLandingPage);
  application.get('/api', renderLandingPage);

  application.get('/api/status', (context) => {
    const environment = resolveEnvironment();
    return context.json({
      status: 'operational',
      botTokenConfigured: parseTelegramBotToken(environment.BOT_TOKEN) !== null,
      defaultChatIdConfigured: parseTelegramChatId(environment.CHAT_ID) !== null,
    }, 200);
  });

  application.get('/api/hello', (context) => {
    return context.json({ message: 'hello, world' }, 200);
  });

  application.post('/api/inbound', handleInboundWebhook);
  application.post('/api/inbound/:chat_id', handleInboundWebhook);

  application.post('/', handleTelegramWebhook);
  application.post('/api', handleTelegramWebhook);
  application.post('/api/telegram', handleTelegramWebhook);
  application.post('/api/webhook', handleTelegramWebhook);

  application.post('/api/register-webhook', handleRegisterWebhook);
  application.post('/api/telegram/register', handleRegisterWebhook);

  return application;
}

const app = createInboundWebhookApp();

export default app;
