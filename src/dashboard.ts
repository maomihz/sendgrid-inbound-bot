export function renderServiceLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SendGrid Inbound Telegram Bot</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b0f19;
      --text: #f8fafc;
      --muted: #94a3b8;
      --card-bg: #111827;
      --border: #1f2937;
      --badge-bg: rgba(34, 197, 94, 0.12);
      --badge-text: #4ade80;
      --btn-bg: #2563eb;
      --btn-hover: #1d4ed8;
      --btn-text: #ffffff;
      --status-success: #4ade80;
      --status-error: #f87171;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --text: #0f172a;
        --muted: #64748b;
        --card-bg: #ffffff;
        --border: #e2e8f0;
        --badge-bg: #dcfce7;
        --badge-text: #166534;
        --btn-bg: #2563eb;
        --btn-hover: #1d4ed8;
        --btn-text: #ffffff;
        --status-success: #166534;
        --status-error: #dc2626;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.875rem;
      padding: 2rem 2.25rem;
      max-width: 26rem;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      background: var(--badge-bg);
      color: var(--badge-text);
      margin-bottom: 1rem;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: currentColor;
    }
    h1 {
      font-size: 1.15rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
    }
    p {
      margin: 0;
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.5;
    }
    .action-group {
      margin-top: 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }
    .register-button {
      background: var(--btn-bg);
      color: var(--btn-text);
      border: none;
      border-radius: 0.5rem;
      padding: 0.625rem 1.25rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.15s ease, opacity 0.15s ease;
      width: 100%;
    }
    .register-button:hover:not(:disabled) {
      background: var(--btn-hover);
    }
    .register-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .status-feedback {
      font-size: 0.825rem;
      min-height: 1.25rem;
      color: var(--muted);
      word-break: break-word;
    }
    .status-feedback.success {
      color: var(--status-success);
    }
    .status-feedback.error {
      color: var(--status-error);
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="badge"><span class="dot"></span>Operational</div>
    <h1>SendGrid Inbound Telegram Bot</h1>
    <p>Webhook receiver forwarding incoming SendGrid emails to Telegram.</p>
    <div class="action-group">
      <button id="register-webhook-button" type="button" class="register-button">Register Webhook</button>
      <div id="webhook-feedback" class="status-feedback" aria-live="polite"></div>
    </div>
  </main>
  <script>
    const registerButton = document.getElementById('register-webhook-button');
    const feedbackElement = document.getElementById('webhook-feedback');

    if (registerButton && feedbackElement) {
      registerButton.addEventListener('click', async () => {
        registerButton.disabled = true;
        feedbackElement.className = 'status-feedback';
        feedbackElement.textContent = 'Registering webhook...';

        try {
          const response = await fetch('/api/register-webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: window.location.href }),
          });

          const result = await response.json();
          if (response.ok && result.ok) {
            feedbackElement.className = 'status-feedback success';
            feedbackElement.textContent = 'Webhook registered successfully!';
          } else {
            feedbackElement.className = 'status-feedback error';
            feedbackElement.textContent = result.message || 'Failed to register webhook.';
          }
        } catch {
          feedbackElement.className = 'status-feedback error';
          feedbackElement.textContent = 'Network error while registering webhook.';
        } finally {
          registerButton.disabled = false;
        }
      });
    }
  </script>
</body>
</html>`;
}
