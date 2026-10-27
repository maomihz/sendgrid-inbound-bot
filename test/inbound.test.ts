import { describe, expect, it } from 'vitest';
import defaultApp from '../api/index.js';
import { createInboundWebhookApp } from '../src/app.js';
import {
  deriveTelegramSecretToken,
  escapeAndTruncateTelegramHtml,
  escapeTelegramHtml,
  formatArchiveFilename,
  formatTelegramCaptionHtml,
} from '../src/telegram.js';
import type { TelegramBotToken } from '../src/types.js';

interface CapturedTelegramRequest {
  readonly url: string;
  readonly method: string;
  readonly formData: FormData;
  readonly bodyText?: string | undefined;
  readonly bodyJson?: Record<string, unknown> | undefined;
}

function createFakeTelegramFetch(responseStatus = 200): {
  readonly fetchStub: typeof fetch;
  readonly capturedRequests: CapturedTelegramRequest[];
} {
  const capturedRequests: CapturedTelegramRequest[] = [];

  const fetchStub: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const formData = init?.body instanceof FormData ? init.body : new FormData();

    let bodyText: string | undefined;
    let bodyJson: Record<string, unknown> | undefined;

    if (typeof init?.body === 'string') {
      bodyText = init.body;
      try {
        bodyJson = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        // Body was not JSON
      }
    }

    capturedRequests.push({ url, method, formData, bodyText, bodyJson });

    return new Response(JSON.stringify({ ok: responseStatus === 200 }), {
      status: responseStatus,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchStub, capturedRequests };
}

function buildInboundMultipartRequest(
  path: string,
  fields: Record<string, string>,
): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return new Request(`http://localhost${path}`, {
    method: 'POST',
    body: formData,
  });
}

function buildAuthorizedTelegramRequest(options: {
  readonly path: string;
  readonly botToken: string;
  readonly body: unknown;
}): Request {
  const resolvedSecret = deriveTelegramSecretToken(
    options.botToken as TelegramBotToken,
  );
  return new Request(`http://localhost${options.path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': resolvedSecret,
    },
    body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
}

describe('SendGrid Inbound Telegram Webhook', () => {
  it('renders a clean status page on GET / and /api to avoid blank screens', async () => {
    const app = createInboundWebhookApp();

    const rootResponse = await app.request('/');
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get('content-type')).toContain('text/html');
    const rootHtml = await rootResponse.text();
    expect(rootHtml).toContain('SendGrid Inbound Telegram Bot');
    expect(rootHtml).toContain('Operational');

    const apiResponse = await app.request('/api');
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get('content-type')).toContain('text/html');
  });

  it('reports operational status and configuration on GET /api/status', async () => {
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
    });

    const response = await app.request('/api/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'operational',
      botTokenConfigured: true,
      defaultChatIdConfigured: true,
    });
  });

  it('responds with greeting on GET /api/hello via the Vercel entrypoint', async () => {
    const response = await defaultApp.request('/api/hello');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'hello, world' });
  });

  it('forwards multipart inbound email to the chat ID specified in the route parameter', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const fixedTimestamp = new Date('2026-10-25T14:30:45.000Z');
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '100000001',
      },
      fetchImplementation: fetchStub,
      currentTimestampProvider: () => fixedTimestamp,
    });

    const rawMimeMessage = [
      'From: Sender Example <sender@example.com>',
      'To: Recipient Example <recipient@example.com>',
      'Subject: Quarterly Report & Summary',
      '',
      'Hello from test body.',
    ].join('\r\n');

    const request = buildInboundMultipartRequest('/api/inbound/-100987654321', {
      from: 'Sender Example <sender@example.com>',
      to: 'Recipient Example <recipient@example.com>',
      subject: 'Quarterly Report & Summary',
      email: rawMimeMessage,
    });

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(capturedRequests).toHaveLength(1);

    const captured = capturedRequests[0];
    expect(captured?.url).toBe(
      'https://api.telegram.org/bot000000000:TEST_BOT_TOKEN_PLACEHOLDER/sendDocument',
    );
    expect(captured?.method).toBe('POST');
    expect(captured?.formData.get('chat_id')).toBe('-100987654321');
    expect(captured?.formData.get('parse_mode')).toBe('HTML');
    expect(captured?.formData.get('caption')).toBe(
      [
        '<b>To:</b> Recipient Example &lt;recipient@example.com&gt;',
        '<b>From:</b> Sender Example &lt;sender@example.com&gt;',
        '<b>Subject:</b> Quarterly Report &amp; Summary',
      ].join('\n'),
    );

    const uploadedDocument = captured?.formData.get('document');
    expect(uploadedDocument).toBeInstanceOf(File);
    if (uploadedDocument instanceof File) {
      expect(uploadedDocument.name).toBe('sendgrid_20261025143045.eml');
      expect(await uploadedDocument.text()).toBe(rawMimeMessage);
    }
  });

  it('falls back to environment CHAT_ID when posting to /api/inbound or /api/inbound/ with trailing slash', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
      fetchImplementation: fetchStub,
      currentTimestampProvider: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    const request = buildInboundMultipartRequest('/api/inbound/', {
      from: 'alerts@example.org',
      to: 'inbox@example.org',
      subject: 'System Status',
      email: 'Raw MIME content',
    });

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.formData.get('chat_id')).toBe('123456789');
  });

  it('rejects requests missing required email fields or containing whitespace-only email content with HTTP 400', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
      fetchImplementation: fetchStub,
    });

    const requestMissingRawEmail = buildInboundMultipartRequest(
      '/api/inbound/123456789',
      {
        from: 'sender@example.com',
        to: 'recipient@example.com',
      },
    );

    const responseMissing = await app.request(requestMissingRawEmail);
    expect(responseMissing.status).toBe(400);
    expect(await responseMissing.json()).toEqual({ message: 'Incorrect parameters.' });

    const requestWhitespaceEmail = buildInboundMultipartRequest(
      '/api/inbound/123456789',
      {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        email: '   \r\n  ',
      },
    );

    const responseWhitespace = await app.request(requestWhitespaceEmail);
    expect(responseWhitespace.status).toBe(400);
    expect(await responseWhitespace.json()).toEqual({
      message: 'Incorrect parameters.',
    });
    expect(capturedRequests).toHaveLength(0);
  });

  it('returns HTTP 400 instead of 500 when multipart body lacks a valid boundary', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
      fetchImplementation: fetchStub,
    });

    const malformedMultipartRequest = new Request(
      'http://localhost/api/inbound/123456789',
      {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
        body: 'corrupted-multipart-payload',
      },
    );

    const response = await app.request(malformedMultipartRequest);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Incorrect parameters.' });
    expect(capturedRequests).toHaveLength(0);
  });

  it('rejects requests with missing or invalid chat_id with HTTP 400', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
      },
      fetchImplementation: fetchStub,
    });

    const request = buildInboundMultipartRequest('/api/inbound/not-a-valid-chat-id', {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      email: 'Raw MIME content',
    });

    const response = await app.request(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Incorrect parameters.' });
    expect(capturedRequests).toHaveLength(0);
  });

  it('returns HTTP 502 when the upstream Telegram Bot API rejects the upload or throws a network error', async () => {
    const { fetchStub } = createFakeTelegramFetch(403);
    const appWithHttpFailure = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
      fetchImplementation: fetchStub,
    });

    const request = buildInboundMultipartRequest('/api/inbound/123456789', {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test',
      email: 'Raw MIME content',
    });

    const httpFailureResponse = await appWithHttpFailure.request(request);
    expect(httpFailureResponse.status).toBe(502);
    expect(await httpFailureResponse.json()).toEqual({
      message: 'Failed to deliver message to Telegram.',
    });

    const appWithNetworkFailure = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
        CHAT_ID: '123456789',
      },
      fetchImplementation: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const networkFailureResponse = await appWithNetworkFailure.request(
      buildInboundMultipartRequest('/api/inbound/123456789', {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test',
        email: 'Raw MIME content',
      }),
    );

    expect(networkFailureResponse.status).toBe(502);
    expect(await networkFailureResponse.json()).toEqual({
      message: 'Failed to deliver message to Telegram.',
    });
  });

  it('escapes HTML entities and truncates captions without splitting entities, tags, or surrogate pairs', () => {
    expect(escapeTelegramHtml('User <user@example.com> & "Admin"')).toBe(
      'User &lt;user@example.com&gt; &amp; &quot;Admin&quot;',
    );

    expect(escapeAndTruncateTelegramHtml('A<B', 4)).toBe('A…');
    expect(escapeAndTruncateTelegramHtml('A🚀B', 3)).toBe('A…');

    const longSubject = 'A'.repeat(1200);
    const caption = formatTelegramCaptionHtml({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: longSubject,
      rawMimeContent: 'MIME',
    });

    expect(caption.length).toBe(1024);
    expect(caption.endsWith('…')).toBe(true);

    const oversizedToHeader = Array.from(
      { length: 40 },
      (_, index) => `User ${index} <user${index}@example.com>`,
    ).join(', ');

    const captionWithHugeTo = formatTelegramCaptionHtml({
      from: 'sender@example.com',
      to: oversizedToHeader,
      subject: 'Important Notice <urgent>',
      rawMimeContent: 'MIME',
    });

    expect(captionWithHugeTo.length).toBeLessThanOrEqual(1024);
    expect(captionWithHugeTo).toContain('<b>From:</b> sender@example.com');
    expect(captionWithHugeTo).toContain('<b>Subject:</b> Important Notice &lt;urgent&gt;');
  });

  it('formats archive filenames using 24-hour UTC timestamps', () => {
    const sampleDate = new Date('2026-12-31T23:59:08.000Z');
    expect(formatArchiveFilename(sampleDate)).toBe('sendgrid_20261231235908.eml');
  });

  it('renders a landing page containing the webhook registration button and status container', async () => {
    const app = createInboundWebhookApp();
    const response = await app.request('/');
    expect(response.status).toBe(200);

    const htmlContent = await response.text();
    expect(htmlContent).toContain('id="register-webhook-button"');
    expect(htmlContent).toContain('id="webhook-feedback"');
    expect(htmlContent).toContain('Register Webhook');
    expect(htmlContent).toContain('/api/register-webhook');
  });

  it('registers webhook with Telegram using the request origin', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
      },
      fetchImplementation: fetchStub,
    });

    const registrationRequest = new Request('https://example.org/api/register-webhook', {
      method: 'POST',
    });

    const response = await app.request(registrationRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: 'Webhook registered successfully.',
      url: 'https://example.org/api/telegram',
    });

    expect(capturedRequests).toHaveLength(1);
    const captured = capturedRequests[0];
    expect(captured?.url).toBe(
      'https://api.telegram.org/bot000000000:TEST_BOT_TOKEN_PLACEHOLDER/setWebhook',
    );
    expect(captured?.method).toBe('POST');
    expect(captured?.bodyJson?.url).toBe('https://example.org/api/telegram');
    expect(typeof captured?.bodyJson?.secret_token).toBe('string');
    expect((captured?.bodyJson?.secret_token as string).length).toBeGreaterThan(0);
  });

  it('rejects webhook registration when bot token is not configured with HTTP 500', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {},
      fetchImplementation: fetchStub,
    });

    const request = new Request('https://example.org/api/register-webhook', {
      method: 'POST',
    });

    const response = await app.request(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      message: 'Telegram bot token is not configured.',
    });
    expect(capturedRequests).toHaveLength(0);
  });

  it('returns HTTP 502 when Telegram setWebhook API rejects registration', async () => {
    const { fetchStub } = createFakeTelegramFetch(400);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
      },
      fetchImplementation: fetchStub,
    });

    const request = new Request('https://example.org/api/register-webhook', {
      method: 'POST',
    });

    const response = await app.request(request);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      message: 'Failed to register webhook with Telegram.',
    });
  });

  it('rejects incoming webhook updates with missing or invalid secret token with HTTP 401', async () => {
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: '000000000:TEST_BOT_TOKEN_PLACEHOLDER',
      },
      fetchImplementation: fetchStub,
    });

    const updatePayload = {
      update_id: 999,
      message: {
        message_id: 100,
        chat: { id: 123456, type: 'private' },
        date: 1700000000,
        text: '/start',
      },
    };

    const requestMissingHeader = new Request('http://localhost/api/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });
    const responseMissing = await app.request(requestMissingHeader);
    expect(responseMissing.status).toBe(401);
    expect(await responseMissing.json()).toEqual({
      message: 'Unauthorized webhook request.',
    });

    const requestInvalidHeader = new Request('http://localhost/api/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong-secret-token',
      },
      body: JSON.stringify(updatePayload),
    });
    const responseInvalid = await app.request(requestInvalidHeader);
    expect(responseInvalid.status).toBe(401);
    expect(await responseInvalid.json()).toEqual({
      message: 'Unauthorized webhook request.',
    });

    expect(capturedRequests).toHaveLength(0);
  });

  it('handles /start, /help, and /hello bot commands and replies with appropriate text', async () => {
    const botToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: botToken,
      },
      fetchImplementation: fetchStub,
    });

    const testCases = [
      {
        command: '/start',
        expectedTextFragment: 'SendGrid Inbound Bot is active and ready',
      },
      {
        command: '/help',
        expectedTextFragment: 'Available commands:',
      },
      {
        command: '/hello',
        expectedTextFragment: 'Hello, Tester! The bot is operational.',
      },
    ];

    for (const [index, testCase] of testCases.entries()) {
      const updatePayload = {
        update_id: 1000 + index,
        message: {
          message_id: 200 + index,
          from: { id: 123456, is_bot: false, first_name: 'Tester' },
          chat: { id: 123456, type: 'private' },
          date: 1700000000 + index,
          text: testCase.command,
        },
      };

      const request = buildAuthorizedTelegramRequest({
        path: '/api/telegram',
        botToken,
        body: updatePayload,
      });

      const response = await app.request(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    expect(capturedRequests).toHaveLength(3);

    for (const [index, testCase] of testCases.entries()) {
      const captured = capturedRequests[index];
      expect(captured?.url).toBe(
        'https://api.telegram.org/bot000000000:TEST_BOT_TOKEN_PLACEHOLDER/sendMessage',
      );
      expect(captured?.method).toBe('POST');
      expect(captured?.bodyJson?.chat_id).toBe(123456);
      expect(typeof captured?.bodyJson?.text).toBe('string');
      expect(captured?.bodyJson?.text as string).toContain(testCase.expectedTextFragment);
    }
  });

  it('handles bot commands case-insensitively, with bot username mentions, and with trailing arguments', async () => {
    const botToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: botToken,
      },
      fetchImplementation: fetchStub,
    });

    const commandVariations = [
      '/START',
      '/start@TestInboundBot',
      '/help additional parameters',
      '/HELLO @friend',
    ];

    for (const [index, commandText] of commandVariations.entries()) {
      const updatePayload = {
        update_id: 2000 + index,
        message: {
          message_id: 300 + index,
          from: { id: 789012, is_bot: false, first_name: 'Tester' },
          chat: { id: 789012, type: 'private' },
          date: 1700000000 + index,
          text: commandText,
        },
      };

      const request = buildAuthorizedTelegramRequest({
        path: '/api/telegram',
        botToken,
        body: updatePayload,
      });

      const response = await app.request(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    expect(capturedRequests).toHaveLength(4);
    expect(capturedRequests[0]?.bodyJson?.text).toContain('SendGrid Inbound Bot is active and ready');
    expect(capturedRequests[1]?.bodyJson?.text).toContain('SendGrid Inbound Bot is active and ready');
    expect(capturedRequests[2]?.bodyJson?.text).toContain('Available commands:');
    expect(capturedRequests[3]?.bodyJson?.text).toContain('Hello, Tester! The bot is operational.');
  });

  it('gracefully acknowledges non-command messages and unknown commands with HTTP 200 without sending messages', async () => {
    const botToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const { fetchStub, capturedRequests } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: botToken,
      },
      fetchImplementation: fetchStub,
    });

    const ignoredPayloads = [
      {
        update_id: 3001,
        message: {
          message_id: 401,
          chat: { id: 123456, type: 'private' },
          date: 1700000000,
          text: 'Regular conversational message',
        },
      },
      {
        update_id: 3002,
        message: {
          message_id: 402,
          chat: { id: 123456, type: 'private' },
          date: 1700000001,
          text: '/unknown_command',
        },
      },
      {
        update_id: 3003,
      },
    ];

    for (const payload of ignoredPayloads) {
      const response = await app.request(
        buildAuthorizedTelegramRequest({
          path: '/api/telegram',
          botToken,
          body: payload,
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }

    expect(capturedRequests).toHaveLength(0);
  });

  it('returns HTTP 400 for malformed Telegram update payloads', async () => {
    const botToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const { fetchStub } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: botToken,
      },
      fetchImplementation: fetchStub,
    });

    const nonJsonRequest = buildAuthorizedTelegramRequest({
      path: '/api/telegram',
      botToken,
      body: 'invalid-json',
    });
    const nonJsonResponse = await app.request(nonJsonRequest);
    expect(nonJsonResponse.status).toBe(400);

    const missingUpdateIdRequest = buildAuthorizedTelegramRequest({
      path: '/api/telegram',
      botToken,
      body: { foo: 'bar' },
    });
    const missingUpdateIdResponse = await app.request(missingUpdateIdRequest);
    expect(missingUpdateIdResponse.status).toBe(400);
    expect(await missingUpdateIdResponse.json()).toEqual({
      message: 'Incorrect parameters.',
    });
  });

  it('returns HTTP 500 when bot token is not configured during command processing', async () => {
    const { fetchStub } = createFakeTelegramFetch(200);
    const app = createInboundWebhookApp({
      environment: {},
      fetchImplementation: fetchStub,
    });

    const request = new Request('http://localhost/api/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        update_id: 4001,
        message: {
          message_id: 501,
          chat: { id: 123456, type: 'private' },
          date: 1700000000,
          text: '/start',
        },
      }),
    });

    const response = await app.request(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: 'Telegram bot token is not configured.',
    });
  });

  it('returns HTTP 502 when upstream Telegram sendMessage fails', async () => {
    const botToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const { fetchStub } = createFakeTelegramFetch(500);
    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: botToken,
      },
      fetchImplementation: fetchStub,
    });

    const request = buildAuthorizedTelegramRequest({
      path: '/api/telegram',
      botToken,
      body: {
        update_id: 5001,
        message: {
          message_id: 601,
          chat: { id: 123456, type: 'private' },
          date: 1700000000,
          text: '/hello',
        },
      },
    });

    const response = await app.request(request);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: 'Failed to deliver message to Telegram.',
    });
  });
});
