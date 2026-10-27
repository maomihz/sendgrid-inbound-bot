import { createHmac } from 'node:crypto';
import type {
  InboundEmailPayload,
  TelegramBotToken,
  TelegramChatId,
} from './types.js';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const MAX_ADDRESS_FIELD_ESCAPED_LENGTH = 300;

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

export async function deliverEmailDocumentToTelegram(options: {
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

export const TELEGRAM_BOT_COMMAND_RESPONSES = {
  START: 'Welcome! SendGrid Inbound Bot is active and ready.',
  HELP: 'Available commands:\n/start - Verify bot connectivity\n/help - View available commands\n/hello - Receive a greeting',
  HELLO: 'Hello! The bot is operational.',
} as const;

export function resolveBotCommandResponse(
  rawText: string,
  senderName?: string,
): string | null {
  const commandToken = rawText.trim().split(/\s+/)[0] ?? '';
  const normalizedCommand = (commandToken.split('@')[0] ?? '').toLowerCase();

  switch (normalizedCommand) {
    case '/start':
      return TELEGRAM_BOT_COMMAND_RESPONSES.START;
    case '/help':
      return TELEGRAM_BOT_COMMAND_RESPONSES.HELP;
    case '/hello': {
      const trimmedSender = senderName?.trim();
      return trimmedSender && trimmedSender.length > 0
        ? `Hello, ${trimmedSender}! The bot is operational.`
        : TELEGRAM_BOT_COMMAND_RESPONSES.HELLO;
    }
    default:
      return null;
  }
}

export function deriveTelegramSecretToken(botToken: TelegramBotToken): string {
  return createHmac('sha256', botToken).update('telegram-webhook').digest('hex');
}

export async function registerTelegramWebhook(options: {
  readonly botToken: TelegramBotToken;
  readonly webhookUrl: string;
  readonly fetchImplementation: typeof fetch;
}): Promise<boolean> {
  const endpointUrl = `${TELEGRAM_API_BASE_URL}/bot${options.botToken}/setWebhook`;

  try {
    const response = await options.fetchImplementation(endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: options.webhookUrl,
        secret_token: deriveTelegramSecretToken(options.botToken),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramTextMessage(options: {
  readonly botToken: TelegramBotToken;
  readonly chatId: number | string;
  readonly text: string;
  readonly fetchImplementation: typeof fetch;
}): Promise<boolean> {
  const endpointUrl = `${TELEGRAM_API_BASE_URL}/bot${options.botToken}/sendMessage`;

  try {
    const response = await options.fetchImplementation(endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: options.chatId,
        text: options.text,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
