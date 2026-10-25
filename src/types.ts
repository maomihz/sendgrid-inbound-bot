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

export type RawBodyFieldValue = string | File | (string | File)[] | undefined;
export type RawBodyRecord = Record<string, RawBodyFieldValue>;
