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

export type RawBodyFieldValue = string | File | (string | File)[] | undefined;
export type RawBodyRecord = Record<string, RawBodyFieldValue>;
