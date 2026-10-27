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
  deriveTelegramSecretToken,
  formatArchiveFilename,
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

    const webhookUrl = new URL('/api/telegram', context.req.url).href;
    const isRegistered = await registerTelegramWebhook({
      botToken,
      webhookUrl,
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
        url: webhookUrl,
      },
      200,
    );
  };

  const handleTelegramWebhook = async (context: Context): Promise<Response> => {
    const environment = resolveEnvironment();
    const botToken = parseTelegramBotToken(environment.BOT_TOKEN);
    if (botToken === null) {
      return context.json(
        { message: 'Telegram bot token is not configured.' },
        500,
      );
    }

    const secretHeader = context.req.header('x-telegram-bot-api-secret-token');
    if (secretHeader !== deriveTelegramSecretToken(botToken)) {
      return context.json({ message: 'Unauthorized webhook request.' }, 401);
    }

    let update: TelegramUpdate;
    try {
      update = (await context.req.json()) as TelegramUpdate;
    } catch {
      return context.json({ message: 'Invalid JSON payload.' }, 400);
    }

    if (typeof update?.update_id !== 'number') {
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const messageText = update.message?.text;
    const chatId = update.message?.chat?.id;
    if (
      typeof messageText !== 'string' ||
      (typeof chatId !== 'number' && typeof chatId !== 'string')
    ) {
      return context.json({ ok: true }, 200);
    }

    const senderName =
      update.message?.from?.first_name?.trim() ||
      update.message?.from?.username?.trim();
    const commandResponseText = resolveBotCommandResponse(messageText, senderName);
    if (commandResponseText === null) {
      return context.json({ ok: true }, 200);
    }

    const isSent = await sendTelegramTextMessage({
      botToken,
      chatId,
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

  application.post('/api/telegram', handleTelegramWebhook);
  application.post('/api/register-webhook', handleRegisterWebhook);

  return application;
}

const app = createInboundWebhookApp();

export default app;
