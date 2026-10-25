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
