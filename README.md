# Banjg Property

AI-assisted repair coordination for Australian property managers. See [HANDOVER.md](HANDOVER.md) for setup, architecture and the to-do list, and [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) for the project plan.

## Demo

Open the deployed demo at [banjg-property.86yixuanchen.workers.dev](https://banjg-property.86yixuanchen.workers.dev).

- Email: `demo+clerk_test@example.com`
- Verification code: `424242`
- Username: `banjg_demo`
- Password: not required

The demo account contains fictional repair requests, contacts, emails, quotes, appointments and AI summaries. Its Gmail connection is simulated, so no real email is sent. This is a shared Clerk development-mode account with a fixed test code; use it only for demonstrations and do not enter real or sensitive information.

The Unified Inbox includes Inbox, Sent, Trash, a new-email composer, replies, and repair-request linking. Deleting moves mail to Gmail Trash; Restore returns it without permanently deleting it. Existing users must reconnect Gmail to grant `gmail.modify` permission for moving mail. Declare this scope in Google Auth Platform → Data Access. Each sync fetches up to 100 messages from the last 30 days; this is not a full historical mailbox import. Demo mail actions remain simulated.

## Development

Requires Node.js 20+ and npm.

```sh
npm install
cp .env.example .env.local   # fill in Clerk, DeepSeek and (optional) Google keys
npx wrangler d1 migrations apply DB --local
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Clerk
- Cloudflare D1 + Drizzle

## Reliability changes

Before deploying this version, apply the new D1 migration (`0005_reliable_operations.sql`):

```sh
npx wrangler d1 migrations apply DB --local
# Apply to the production database before releasing the new Worker:
npx wrangler d1 migrations apply DB --remote
```

- Request numbers are reserved on the server. Creation and its timeline entry are saved together before the UI navigates to the request.
- Email linking prefers an existing conversation or an explicit request ID. Shared contacts and conflicting references stay unlinked for manual review. Existing links are preserved.
- Connecting a different Gmail address is blocked while a mailbox is connected. Disconnect first; disconnecting removes the cached emails from this app. Reconnecting the same address preserves its cache. Old in-flight mailbox writes are rejected after the connection changes.
- Each email send has a durable operation ID. Retries of the same draft reuse it, including after a page reload in the same browser tab. If Gmail accepted the email but local saving failed, retrying repairs the local record without sending again. Lost responses are reconciled against Gmail Sent using a stable Message-ID; if delivery cannot be confirmed, the operation stays blocked and the UI asks the user to check Gmail Sent. Do not create a replacement draft until its delivery status is known. Gmail search can take time to reflect a new message.
- Send-operation records include message content for recovery and are retained in D1. They are scoped to the signed-in user and mailbox.
