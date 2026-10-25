import { type Context, Hono } from 'hono';

export type TelegramBotToken = string & { readonly __brand: 'TelegramBotToken' };
export type TelegramChatId = string & { readonly __brand: 'TelegramChatId' };

export interface InboundEmailPayload {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly rawMimeContent: string;
}

export interface WebhookEnvironment {
  readonly BOT_TOKEN?: string | undefined;
  readonly CHAT_ID?: string | undefined;
}

export interface WebhookAppDependencies {
  readonly environment?: WebhookEnvironment;
  readonly fetchImplementation?: typeof fetch;
  readonly currentTimestampProvider?: () => Date;
}

export interface WebhookTelemetryCounters {
  readonly receivedRequests: number;
  readonly deliveredEmails: number;
  readonly failedDeliveries: number;
  readonly rejectedRequests: number;
}

export interface WebhookTelemetrySnapshot {
  readonly status: 'operational' | 'misconfigured';
  readonly botTokenConfigured: boolean;
  readonly defaultChatIdConfigured: boolean;
  readonly instanceStartedAt: string;
  readonly lastDeliveryAt: string | null;
  readonly counters: WebhookTelemetryCounters;
}

type RawBodyFieldValue = string | File | (string | File)[] | undefined;
type RawBodyRecord = Record<string, RawBodyFieldValue>;

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const MAX_ADDRESS_FIELD_ESCAPED_LENGTH = 300;
const TELEGRAM_CHAT_ID_PATTERN = /^(?:-?\d+|@[a-zA-Z0-9_]{5,})$/;

export function parseTelegramBotToken(rawValue: string | undefined): TelegramBotToken | null {
  const trimmedValue = rawValue?.trim() ?? '';
  if (trimmedValue.length === 0) {
    return null;
  }
  return trimmedValue as TelegramBotToken;
}

export function parseTelegramChatId(rawValue: string | undefined): TelegramChatId | null {
  const trimmedValue = rawValue?.trim() ?? '';
  if (!TELEGRAM_CHAT_ID_PATTERN.test(trimmedValue)) {
    return null;
  }
  return trimmedValue as TelegramChatId;
}

export function escapeTelegramHtml(rawText: string): string {
  return rawText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function escapeAndTruncateTelegramHtml(
  rawText: string,
  maxEscapedLength: number,
): string {
  const fullEscapedText = escapeTelegramHtml(rawText);
  if (fullEscapedText.length <= maxEscapedLength) {
    return fullEscapedText;
  }
  if (maxEscapedLength <= 0) {
    return '';
  }

  const targetBudgetBeforeEllipsis = maxEscapedLength - 1;
  let accumulatedHtml = '';

  for (const codePointCharacter of rawText) {
    const escapedCharacter = escapeTelegramHtml(codePointCharacter);
    if (accumulatedHtml.length + escapedCharacter.length > targetBudgetBeforeEllipsis) {
      break;
    }
    accumulatedHtml += escapedCharacter;
  }

  return `${accumulatedHtml}…`;
}

export function formatTelegramCaptionHtml(email: InboundEmailPayload): string {
  const escapedRecipient = escapeAndTruncateTelegramHtml(
    email.to,
    MAX_ADDRESS_FIELD_ESCAPED_LENGTH,
  );
  const escapedSender = escapeAndTruncateTelegramHtml(
    email.from,
    MAX_ADDRESS_FIELD_ESCAPED_LENGTH,
  );

  const headerPrefix = [
    `<b>To:</b> ${escapedRecipient}`,
    `<b>From:</b> ${escapedSender}`,
    '<b>Subject:</b> ',
  ].join('\n');

  const remainingSubjectBudget = TELEGRAM_CAPTION_MAX_LENGTH - headerPrefix.length;
  const escapedSubject = escapeAndTruncateTelegramHtml(
    email.subject,
    remainingSubjectBudget,
  );

  return `${headerPrefix}${escapedSubject}`;
}

export function formatArchiveFilename(timestamp: Date): string {
  const compactUtcTimestamp = timestamp
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replaceAll('T', '')
    .slice(0, 14);

  return `sendgrid_${compactUtcTimestamp}.eml`;
}

async function extractTextFieldValue(rawField: RawBodyFieldValue): Promise<string> {
  const singleValue = Array.isArray(rawField) ? rawField[0] : rawField;
  if (typeof singleValue === 'string') {
    return singleValue;
  }
  if (singleValue instanceof File) {
    return await singleValue.text();
  }
  return '';
}

export async function parseInboundEmailPayload(
  parsedBody: RawBodyRecord,
): Promise<InboundEmailPayload | null> {
  const senderAddress = (await extractTextFieldValue(parsedBody.from)).trim();
  const recipientAddress = (await extractTextFieldValue(parsedBody.to)).trim();
  const rawMimeContent = await extractTextFieldValue(parsedBody.email);
  const subjectLine = (await extractTextFieldValue(parsedBody.subject)).trim();

  if (
    senderAddress.length === 0 ||
    recipientAddress.length === 0 ||
    rawMimeContent.trim().length === 0
  ) {
    return null;
  }

  return {
    from: senderAddress,
    to: recipientAddress,
    subject: subjectLine,
    rawMimeContent,
  };
}

async function readRequestBodyFields(context: Context): Promise<RawBodyRecord | null> {
  const contentTypeHeader = context.req.header('content-type')?.toLowerCase() ?? '';

  try {
    if (contentTypeHeader.startsWith('application/json')) {
      const jsonPayload: unknown = await context.req.json();
      if (
        typeof jsonPayload !== 'object' ||
        jsonPayload === null ||
        Array.isArray(jsonPayload)
      ) {
        return null;
      }

      const normalizedRecord: RawBodyRecord = {};
      for (const [key, value] of Object.entries(jsonPayload)) {
        if (typeof value === 'string') {
          normalizedRecord[key] = value;
        }
      }
      return normalizedRecord;
    }

    return await context.req.parseBody({ all: false });
  } catch {
    return null;
  }
}

async function deliverEmailDocumentToTelegram(options: {
  readonly botToken: TelegramBotToken;
  readonly chatId: TelegramChatId;
  readonly emailPayload: InboundEmailPayload;
  readonly archiveFilename: string;
  readonly fetchImplementation: typeof fetch;
}): Promise<boolean> {
  const telegramFormData = new FormData();
  telegramFormData.set('chat_id', options.chatId);
  telegramFormData.set('caption', formatTelegramCaptionHtml(options.emailPayload));
  telegramFormData.set('parse_mode', 'HTML');

  const emlDocumentBlob = new Blob([options.emailPayload.rawMimeContent], {
    type: 'message/rfc822',
  });
  telegramFormData.set('document', emlDocumentBlob, options.archiveFilename);

  const endpointUrl = `${TELEGRAM_API_BASE_URL}/bot${options.botToken}/sendDocument`;

  try {
    const response = await options.fetchImplementation(endpointUrl, {
      method: 'POST',
      body: telegramFormData,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function renderStatusDashboardHtml(telemetry: WebhookTelemetrySnapshot): string {
  const isOperational = telemetry.status === 'operational';
  const statusLabel = isOperational ? 'Operational' : 'Bot Token Missing';
  const statusToneClass = isOperational ? 'badge-ok' : 'badge-warn';
  const botTokenBadge = telemetry.botTokenConfigured ? 'Configured' : 'Missing';
  const botTokenTone = telemetry.botTokenConfigured ? 'badge-ok' : 'badge-warn';
  const defaultChatBadge = telemetry.defaultChatIdConfigured
    ? 'Configured'
    : 'Route Param Only';
  const defaultChatTone = telemetry.defaultChatIdConfigured ? 'badge-ok' : 'badge-neutral';
  const lastDeliveryLabel = escapeTelegramHtml(telemetry.lastDeliveryAt ?? 'No deliveries yet');
  const instanceStartedLabel = escapeTelegramHtml(telemetry.instanceStartedAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SendGrid Inbound Bot — Service Status</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --code-bg: #f1f5f9;
      --ok-bg: #dcfce7;
      --ok-text: #166534;
      --warn-bg: #fef3c7;
      --warn-text: #92400e;
      --neutral-bg: #e2e8f0;
      --neutral-text: #334155;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0f19;
        --surface: #111827;
        --border: #1f2937;
        --text: #f8fafc;
        --muted: #94a3b8;
        --code-bg: #1e293b;
        --ok-bg: #064e3b;
        --ok-text: #6ee7b7;
        --warn-bg: #78350f;
        --warn-text: #fcd34d;
        --neutral-bg: #1f2937;
        --neutral-text: #cbd5e1;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 2rem 1rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      max-width: 44rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem 1.5rem;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    h1 {
      font-size: 1.25rem;
      margin: 0;
      font-weight: 600;
    }
    h2 {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin: 0 0 0.875rem 0;
    }
    p.subtitle {
      margin: 0.25rem 0 0 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .badge-ok { background: var(--ok-bg); color: var(--ok-text); }
    .badge-warn { background: var(--warn-bg); color: var(--warn-text); }
    .badge-neutral { background: var(--neutral-bg); color: var(--neutral-text); }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
      gap: 0.75rem;
    }
    .stat-box {
      padding: 0.875rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .stat-label {
      font-size: 0.8rem;
      color: var(--muted);
    }
    .meta-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 0.75rem;
      margin-top: 0.875rem;
      padding-top: 0.875rem;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .meta-item span {
      display: block;
      color: var(--muted);
      font-size: 0.75rem;
    }
    .endpoint-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
    .endpoint-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .endpoint-row:last-child { border-bottom: none; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--code-bg);
      padding: 0.15rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.825rem;
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <div class="header-row">
        <div>
          <h1>SendGrid Inbound Telegram Bot</h1>
          <p class="subtitle">Forwards SendGrid Inbound Parse MIME emails to Telegram</p>
        </div>
        <span class="badge ${statusToneClass}">${statusLabel}</span>
      </div>
      <div class="meta-list">
        <div class="meta-item">
          <span>Telegram Bot Token (BOT_TOKEN)</span>
          <strong class="badge ${botTokenTone}">${botTokenBadge}</strong>
        </div>
        <div class="meta-item">
          <span>Default Chat ID (CHAT_ID)</span>
          <strong class="badge ${defaultChatTone}">${defaultChatBadge}</strong>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Instance Telemetry</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value">${telemetry.counters.deliveredEmails}</div>
          <div class="stat-label">Delivered</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${telemetry.counters.receivedRequests}</div>
          <div class="stat-label">Received</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${telemetry.counters.rejectedRequests}</div>
          <div class="stat-label">Rejected (400)</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${telemetry.counters.failedDeliveries}</div>
          <div class="stat-label">Failed (5xx)</div>
        </div>
      </div>
      <div class="meta-list">
        <div class="meta-item">
          <span>Instance Started (UTC)</span>
          <code>${instanceStartedLabel}</code>
        </div>
        <div class="meta-item">
          <span>Last Delivery (UTC)</span>
          <code>${lastDeliveryLabel}</code>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Endpoints</h2>
      <div class="endpoint-list">
        <div class="endpoint-row">
          <code>POST /api/inbound/:chat_id</code>
          <span class="stat-label">Forward inbound email to specific chat ID</span>
        </div>
        <div class="endpoint-row">
          <code>POST /api/inbound</code>
          <span class="stat-label">Forward inbound email to default CHAT_ID</span>
        </div>
        <div class="endpoint-row">
          <code>GET /api/status</code>
          <span class="stat-label">JSON service health and telemetry</span>
        </div>
        <div class="endpoint-row">
          <code>GET /api/hello</code>
          <span class="stat-label">Health probe</span>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

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

const app = createInboundWebhookApp();

export default app;
