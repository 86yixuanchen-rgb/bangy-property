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

## Grace account deployment with shared data

`wrangler.gateway.jsonc` deploys a dedicated signed-query gateway in the original account, bound to the existing `banjg-property-db`. `wrangler.grace.jsonc` deploys the application to Grace's existing `3605assessment` Worker with no native D1 binding. Both sites use the same Clerk instance and share live records; normal application queries remain filtered by Clerk user ID.

Build with `npm run build`. Deploy the gateway with `wrangler deploy --config wrangler.gateway.jsonc`, the original application with the generated `.output/server/wrangler.json`, and Grace with `wrangler deploy --config wrangler.grace.jsonc --keep-vars`. Select the matching account credentials for each command. The original D1 migrations continue to run only in the original account.

Keep `DB_GATEWAY_KEY` as a server secret on all three Workers. Grace also needs the existing Clerk secret, Google OAuth credentials and the existing `TOKEN_ENCRYPTION_KEY` to reuse stored Gmail connections. Never put these values in source control, public variables or frontend code. Grace's `DB_GATEWAY_URL` points to the original gateway; `AI_GATEWAY_URL` points to the original application's signed `/_internal/ai` endpoint, which retains its own DeepSeek credential. Google must allow `https://3605assessment.gracepospisil107.workers.dev/api/gmail/callback` before users reconnect Gmail on that domain. Existing refresh-token connections can continue without an OAuth code exchange.

The gateway verifies HMAC signatures over timestamp, random request identifier and exact body, accepts only a 60-second clock window, limits request sizes and batch sizes, and rejects schema-changing operations. A shared gateway credential authorizes application-level database access, so administrators of either deployment must be trusted with the shared data. Native D1 batches remain atomic; uncertain writes are never retried by the transport. A valid signed request can be replayed inside the acceptance window if its headers and body are compromised: do not log them, and rotate the shared key on exposure. Both gateways fail closed when the key is missing. Signed `/_internal/status` on the application checks the shared database without exposing records.

## Property-centred event records

Apply `0006_property_relationships.sql` before deploying the property-centred feature. It adds property-manager and tenant contact fields, explicit property IDs on repair events and appointments, deletion restrictions and lookup indexes. The migration only links existing events whose trimmed, case-normalized address matches exactly one property in the same user's workspace. Ambiguous or unmatched events remain visible as needing a property and can be linked manually from their event page.

A property currently records one PM, one landlord and one tenant as contact profiles; this is not a separate landlord/tenant login portal. New events must select an existing owned property, use its canonical address and snapshot its contacts. A property page lists its events and appointments. Emails, quotes and timeline entries remain attached to their event, so they inherit that event's property. Standalone appointments must also choose a property. Property contacts appear in Contacts before any event exists.

Editing a property updates displayed addresses on its events in the same transaction, but does not replace historical event participants when a tenant or landlord changes. Properties with event or appointment history cannot be deleted. These changes are implemented locally; publishing requires applying the migration to the original account's D1 before deploying the original application. Do not redeploy the Grace site as part of this feature.
