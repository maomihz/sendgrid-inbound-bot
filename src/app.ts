import { type Context, Hono } from 'hono';
import { renderStatusDashboardHtml } from './dashboard.js';
import {
  parseInboundEmailPayload,
  parseTelegramBotToken,
  parseTelegramChatId,
  readRequestBodyFields,
} from './inbound-parser.js';
import {
  deliverEmailDocumentToTelegram,
  formatArchiveFilename,
} from './telegram.js';
import type {
  WebhookAppDependencies,
  WebhookEnvironment,
  WebhookTelemetrySnapshot,
} from './types.js';

export function createInboundWebhookApp(dependencies: WebhookAppDependencies = {}): Hono {
  const application = new Hono({ strict: false });
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const currentTimestampProvider =
    dependencies.currentTimestampProvider ?? (() => new Date());

  const instanceStartedAt = currentTimestampProvider().toISOString();
  let receivedRequestsCount = 0;
  let deliveredEmailsCount = 0;
  let failedDeliveriesCount = 0;
  let rejectedRequestsCount = 0;
  let lastDeliveryAt: string | null = null;

  const resolveEnvironment = (): WebhookEnvironment =>
    dependencies.environment ?? {
      BOT_TOKEN: process.env.BOT_TOKEN,
      CHAT_ID: process.env.CHAT_ID,
    };

  const buildTelemetrySnapshot = (): WebhookTelemetrySnapshot => {
    const environment = resolveEnvironment();
    const botTokenConfigured = parseTelegramBotToken(environment.BOT_TOKEN) !== null;
    const defaultChatIdConfigured = parseTelegramChatId(environment.CHAT_ID) !== null;

    return {
      status: botTokenConfigured ? 'operational' : 'misconfigured',
      botTokenConfigured,
      defaultChatIdConfigured,
      instanceStartedAt,
      lastDeliveryAt,
      counters: {
        receivedRequests: receivedRequestsCount,
        deliveredEmails: deliveredEmailsCount,
        failedDeliveries: failedDeliveriesCount,
        rejectedRequests: rejectedRequestsCount,
      },
    };
  };

  const handleInboundWebhook = async (context: Context): Promise<Response> => {
    receivedRequestsCount += 1;
    const environment = resolveEnvironment();

    const routeChatIdParameter = context.req.param('chat_id');
    const candidateChatId =
      routeChatIdParameter && routeChatIdParameter.trim().length > 0
        ? routeChatIdParameter
        : environment.CHAT_ID;
    const targetChatId = parseTelegramChatId(candidateChatId);

    if (targetChatId === null) {
      rejectedRequestsCount += 1;
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const parsedBody = await readRequestBodyFields(context);
    if (parsedBody === null) {
      rejectedRequestsCount += 1;
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const emailPayload = await parseInboundEmailPayload(parsedBody);
    if (emailPayload === null) {
      rejectedRequestsCount += 1;
      return context.json({ message: 'Incorrect parameters.' }, 400);
    }

    const botToken = parseTelegramBotToken(environment.BOT_TOKEN);
    if (botToken === null) {
      failedDeliveriesCount += 1;
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
      failedDeliveriesCount += 1;
      return context.json(
        { message: 'Failed to deliver message to Telegram.' },
        502,
      );
    }

    deliveredEmailsCount += 1;
    lastDeliveryAt = currentTimestamp.toISOString();
    return context.json({ status: 'ok' }, 200);
  };

  application.get('/', (context) => {
    const telemetry = buildTelemetrySnapshot();
    return context.html(renderStatusDashboardHtml(telemetry), 200);
  });

  application.get('/api/status', (context) => {
    return context.json(buildTelemetrySnapshot(), 200);
  });

  application.get('/api/hello', (context) => {
    return context.json({ message: 'hello, world' }, 200);
  });

  application.post('/api/inbound', handleInboundWebhook);
  application.post('/api/inbound/:chat_id', handleInboundWebhook);

  return application;
}
