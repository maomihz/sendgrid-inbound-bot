import { escapeTelegramHtml } from './telegram.js';
import type { WebhookTelemetrySnapshot } from './types.js';

export function renderStatusDashboardHtml(telemetry: WebhookTelemetrySnapshot): string {
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
