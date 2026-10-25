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

export function createInboundWebhookApp(dependencies: WebhookAppDependencies = {}): Hono {
  const application = new Hono({ strict: false });
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const currentTimestampProvider =
    dependencies.currentTimestampProvider ?? (() => new Date());

  const handleInboundWebhook = async (context: Context): Promise<Response> => {
    const environment: WebhookEnvironment = dependencies.environment ?? {
      BOT_TOKEN: process.env.BOT_TOKEN,
      CHAT_ID: process.env.CHAT_ID,
    };

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

    const archiveFilename = formatArchiveFilename(currentTimestampProvider());
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

  application.get('/api/hello', (context) => {
    return context.json({ message: 'hello, world' }, 200);
  });

  application.post('/api/inbound', handleInboundWebhook);
  application.post('/api/inbound/:chat_id', handleInboundWebhook);

  return application;
}

const app = createInboundWebhookApp();

export default app;
