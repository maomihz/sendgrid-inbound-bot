import { describe, expect, it } from 'vitest';
import defaultApp from '../api/index.js';
import { createInboundWebhookApp } from '../src/app.js';
import {
  escapeAndTruncateTelegramHtml,
  escapeTelegramHtml,
  formatArchiveFilename,
  formatTelegramCaptionHtml,
} from '../src/telegram.js';

interface CapturedTelegramRequest {
  readonly url: string;
  readonly method: string;
  readonly formData: FormData;
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

    capturedRequests.push({ url, method, formData });

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

describe('SendGrid Inbound Telegram Webhook', () => {
  it('renders the status dashboard on GET / and returns telemetry on GET /api/status without leaking secrets', async () => {
    const { fetchStub } = createFakeTelegramFetch(200);
    const fixedTimestamp = new Date('2026-10-25T14:30:45.000Z');
    const secretToken = '000000000:TEST_BOT_TOKEN_PLACEHOLDER';
    const secretChatId = '-100999888777';

    const app = createInboundWebhookApp({
      environment: {
        BOT_TOKEN: secretToken,
        CHAT_ID: secretChatId,
      },
      fetchImplementation: fetchStub,
      currentTimestampProvider: () => fixedTimestamp,
    });

    const validRequest = buildInboundMultipartRequest('/api/inbound', {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Status Check',
      email: 'Raw MIME content',
    });
    await app.request(validRequest);

    const invalidRequest = buildInboundMultipartRequest('/api/inbound', {
      from: 'sender@example.com',
    });
    await app.request(invalidRequest);

    const statusResponse = await app.request('/api/status');
    expect(statusResponse.status).toBe(200);
    const telemetry = await statusResponse.json();
    expect(telemetry).toEqual({
      status: 'operational',
      botTokenConfigured: true,
      defaultChatIdConfigured: true,
      instanceStartedAt: '2026-10-25T14:30:45.000Z',
      lastDeliveryAt: '2026-10-25T14:30:45.000Z',
      counters: {
        receivedRequests: 2,
        deliveredEmails: 1,
        failedDeliveries: 0,
        rejectedRequests: 1,
      },
    });

    const dashboardResponse = await app.request('/');
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.headers.get('content-type')).toContain('text/html');

    const apiRootDashboardResponse = await app.request('/api');
    expect(apiRootDashboardResponse.status).toBe(200);
    expect(apiRootDashboardResponse.headers.get('content-type')).toContain('text/html');

    const htmlBody = await dashboardResponse.text();
    expect(htmlBody).toContain('SendGrid Inbound Telegram Bot');
    expect(htmlBody).toContain('Operational');
    expect(htmlBody).toContain('2026-10-25T14:30:45.000Z');
    expect(htmlBody).not.toContain(secretToken);
    expect(htmlBody).not.toContain(secretChatId);
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
});
