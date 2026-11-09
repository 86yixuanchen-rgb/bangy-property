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

## Incident action plans

`0007_incident_actions.sql` adds per-action drafts and delivery state; `0008_action_plan_version.sql` records the evidence version even when the AI proposes no actions. Apply both before running the updated event page. The local database has been migrated; production has not been changed.

AI analysis now proposes multiple role-specific emails with independent readiness. The event page separates **Ready now**, **Waiting on conditions** and **Sent**, offers editable drafts, and saves progress across reloads. Recipient addresses are validated against that event's contacts. Quote-approval actions require a recorded pending quote; arranging repairs requires a recorded approved quote. Adding information, changing contacts/quotes, or receiving a new email invalidates old pending plans; regenerate before sending. Outgoing sibling actions do not invalidate each other.

Generation never sends email or changes the board. Each action needs an explicit **Confirm & send**. An action gets a stable operation ID and its exact message becomes immutable once sending begins. Retries reconcile that same message through the existing Gmail delivery protocol. Sent actions survive regeneration; saved edits remain for review. Sent emails and action records appear in the event timeline. “Reply received” is an indicator for PM review, not proof of quote approval or repair completion. Multiple waiting recipients are shown separately. Quote approval alone does not mark a repair as scheduled; an appointment must be recorded.

Analysis runs when an event is opened with new synced evidence, or when the PM requests it. This change does not add a background Gmail polling service, automatically extract quotes, automatically approve work, or send notifications without confirmation. Existing historical events require a property before action emails can be sent. The generic assistant remains available for supplementary questions.


### Local case workflow

The event page now supports independent action outcomes (not required, completed offline, deferred), dated follow-ups on the dashboard, direct reply review, recorded landlord quote decisions with evidence, appointment rescheduling with separate notification drafts, and a dedicated closure record. Generating or preparing drafts never sends them. Closed events stop follow-up reminders; reopen an event before creating new workflow actions.

Properties open into a detail view with people, active and historical events, appointments, missing-contact prompts, and event-scoped contact history and draft creation. Existing event contacts are updated only after explicit review.

Case attachments support PNG, JPEG, WebP and PDF, up to 1 MB per file and 20 MB per event. Images can be previewed; files can be downloaded by the owning workspace. Files are stored in D1 for this local implementation and are not automatically sent to AI. Select up to five case files while reviewing an action or composing a linked email. Confirmation snapshots the exact file names and bytes alongside the send operation, so retries keep the original attachment content.

Local database additions: `0009_case_workflow.sql` and `0010_quote_decision_once.sql`. Follow-ups are in-app reminders when the dashboard is open, not background email delivery. No remote migration or deployment is implied by local development.

### Local workflow management

Migration `0011_workflow_management.sql` adds appointment cancellation history, quote revisions, property archiving, attachment metadata/recycling, immutable outbound attachment snapshots, and per-user notification read state. Apply it locally before previewing these features. No production migration is implied.

Cancelled visits remain visible and generate separate reviewable tenant/team notification drafts. Closure requires cancelling future visits and resolving cancellation drafts, or retaining visits with a recorded reason. Quote revisions start Pending and retain previous versions/decisions. Property correction previews affected contacts, future visits, quotes and drafts; sent messages and evidence stay with the case. Active cases and future visits block property archiving. Property detail URLs use `/workspace/properties?property=<id>` and require the owning account.

Notifications are in-app and refresh every minute; reading them does not change Gmail read state. Timeline categories and dashboard follow-up/waiting filters operate on existing case records. Gmail attachment MIME follows the [Gmail sending guide](https://developers.google.com/workspace/gmail/api/guides/sending).
