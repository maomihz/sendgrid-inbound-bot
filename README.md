# SendGrid Inbound Telegram Bot

Serverless webhook built with [Hono](https://hono.dev/) for [Vercel Functions](https://vercel.com/docs/functions) that receives incoming emails from [SendGrid Inbound Parse](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook) and forwards them to a Telegram chat as `.eml` attachments.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Minimal landing page confirming the service is online. |
| `GET` | `/api/status` | JSON health check confirming configuration status. |
| `GET` | `/api/hello` | Simple health probe returning `{ "message": "hello, world" }`. |
| `POST` | `/api/inbound` | Receives SendGrid `multipart/form-data` payloads and delivers the raw `.eml` message to `CHAT_ID`. |
| `POST` | `/api/inbound/:chat_id` | Receives SendGrid `multipart/form-data` payloads and delivers the raw `.eml` message to the specified `:chat_id`. |

## Configuration

Configure the following environment variables in Vercel:

- `BOT_TOKEN` (required): Telegram Bot API token issued by `@BotFather`.
- `CHAT_ID` (optional if `:chat_id` is provided in the webhook URL): Default target Telegram chat ID (e.g. `123456789`, `-1001234567890`, or `@channel_handle`).

### SendGrid Inbound Parse Setup

1. Point your domain's `MX` record to `mx.sendgrid.net`.
2. In the SendGrid Dashboard under **Settings -> Inbound Parse**, add a host & URL pointing to:
   - `https://<your-deployment-domain>/api/inbound/<chat_id>` (or `/api/inbound` to use the default `CHAT_ID`).
3. Enable **POST the raw, full MIME message** so SendGrid includes the `email` field containing the full `.eml` source.

## Development

```bash
npm install
npm run typecheck
npm test
```
