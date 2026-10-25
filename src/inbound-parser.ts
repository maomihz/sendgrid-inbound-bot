import type { Context } from 'hono';
import type {
  InboundEmailPayload,
  RawBodyFieldValue,
  RawBodyRecord,
  TelegramBotToken,
  TelegramChatId,
} from './types.js';

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

export async function readRequestBodyFields(
  context: Context,
): Promise<RawBodyRecord | null> {
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
