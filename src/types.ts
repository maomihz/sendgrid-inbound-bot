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

export interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramChat {
  readonly id: number | string;
  readonly type: string;
  readonly title?: string;
  readonly username?: string;
  readonly first_name?: string;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
}
