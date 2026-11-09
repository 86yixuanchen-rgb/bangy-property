import { resolveAttachments } from "./mail-attachments.server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  appointments,
  emailMessages,
  gmailAccounts,
  mailSendOperations,
  mailSendFiles,
  repairRequests,
  requestActions,
  requestEvents,
  requestParticipants,
  requestQuotes,
} from "@/db/schema";
import {
  expectsReply,
  actionRole,
  type ActionDraft,
  type PlannedAction,
} from "./incident-action-types";
import type { AppDatabase } from "./db.server";

const scope = (userId: string, requestId: string) =>
  and(eq(requestActions.userId, userId), eq(requestActions.requestId, requestId));
export async function actionContext(db: AppDatabase, userId: string, requestId: string) {
  const [request] = await db
    .select()
    .from(repairRequests)
    .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, requestId)));
  if (!request) throw new Error("Request not found");
  const [participants, quotes, bookings, emails, notes, accounts] = await Promise.all([
    db
      .select()
      .from(requestParticipants)
      .where(
        and(eq(requestParticipants.userId, userId), eq(requestParticipants.requestId, requestId)),
      )
      .orderBy(asc(requestParticipants.email)),
    db
      .select()
      .from(requestQuotes)
      .where(and(eq(requestQuotes.userId, userId), eq(requestQuotes.requestId, requestId)))
      .orderBy(asc(requestQuotes.id)),
    db
      .select()
      .from(appointments)
      .where(and(eq(appointments.userId, userId), eq(appointments.requestId, requestId)))
      .orderBy(asc(appointments.id)),
    db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.userId, userId), eq(emailMessages.requestId, requestId)))
      .orderBy(asc(emailMessages.id)),
    db
      .select()
      .from(requestEvents)
      .where(
        and(
          eq(requestEvents.userId, userId),
          eq(requestEvents.requestId, requestId),
          eq(requestEvents.kind, "note"),
        ),
      )
      .orderBy(asc(requestEvents.id)),
    db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId)),
  ]);
  const own = accounts[0]?.email.toLowerCase();
  const inbound = emails.filter((m) => m.fromEmail.toLowerCase() !== own && !m.sent);
  // Outgoing actions do not invalidate their parallel siblings. Replies, contacts,
  // quotes, notes, property changes and appointments do invalidate old drafts.
  const snapshot = JSON.stringify({
    request: {
      id: request.id,
      title: request.title,
      address: request.address,
      propertyId: request.propertyId,
      closed: request.boardColumn === "Completed",
    },
    participants,
    quotes,
    bookings,
    inbound: inbound.map(
      ({ id, threadId, subject, body, fromEmail, toEmails, receivedAt, trashed }) => ({
        id,
        threadId,
        subject,
        body,
        fromEmail,
        toEmails,
        receivedAt,
        trashed,
      }),
    ),
    notes,
    mailbox: own,
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  const version = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return { request, participants, quotes, bookings, inbound, version, mailboxConnected: !!own };
}
type Context = Awaited<ReturnType<typeof actionContext>>;
export type StoredAction = typeof requestActions.$inferSelect;
export function blockedReason(action: StoredAction, context: Context): string | null {
  if (action.state === "sent" || action.state === "sending") return null;
  if (["done", "skipped"].includes(action.disposition))
    return "This action has been handled. Restore it before sending.";
  if (action.disposition === "deferred" && action.followUpAt && action.followUpAt > Date.now())
    return "Deferred until the follow-up date. Restore it to act now.";
  if (context.request.boardColumn === "Completed")
    return "Reopen this completed event before sending new actions.";
  if (!context.request.propertyId) return "Link a property before contacting anyone.";
  if (action.sourceVersion !== context.version)
    return "New case information is available. Regenerate the plan before sending.";
  if (
    !context.participants.some(
      (p) => p.email.toLowerCase() === action.recipientEmail && p.role === actionRole[action.kind],
    )
  )
    return `Add or confirm the ${actionRole[action.kind].toLowerCase()} contact, then regenerate the plan.`;
  const quote = context.quotes.find((q) => q.id === action.quoteId);
  if (
    action.kind === "request_approval" &&
    (!quote || quote.supersededAt || quote.status !== "Pending")
  )
    return "Record a pending quote and regenerate the plan before requesting approval.";
  if (
    action.kind === "arrange_repair" &&
    (!quote || quote.supersededAt || quote.status !== "Approved")
  )
    return "Record an approved quote and regenerate the plan before arranging repairs.";
  return null;
}
export async function listActionPlan(db: AppDatabase, userId: string, requestId: string) {
  const context = await actionContext(db, userId, requestId);
  const rows = await db
    .select()
    .from(requestActions)
    .where(scope(userId, requestId))
    .orderBy(asc(requestActions.createdAt), asc(requestActions.id));
  const operations = await db
    .select()
    .from(mailSendOperations)
    .where(eq(mailSendOperations.userId, userId));
  const snapshots = await db
    .select({ operationId: mailSendFiles.operationId, name: mailSendFiles.name })
    .from(mailSendFiles)
    .where(eq(mailSendFiles.userId, userId));
  return {
    version: context.version,
    actions: rows
      .filter(
        (a) => a.active || a.state !== "pending" || a.disposition !== "open" || !!a.followUpAt,
      )
      .map((a) => {
        const person = context.participants.find((p) => p.email.toLowerCase() === a.recipientEmail);
        const operation = operations.find((o) => o.operationId === a.operationId);
        const reply =
          a.sentAt && operation?.threadId
            ? context.inbound
                .slice()
                .sort((a, b) => b.receivedAt - a.receivedAt)
                .find(
                  (m) =>
                    !m.trashed &&
                    m.threadId === operation.threadId &&
                    m.fromEmail.toLowerCase() === a.recipientEmail &&
                    m.receivedAt > a.sentAt!,
                )
            : undefined;
        return {
          ...a,
          sentAttachments: snapshots
            .filter((f) => f.operationId === a.operationId)
            .map((f) => f.name),
          recipientName: person?.name ?? actionRole[a.kind],
          recipientRole: actionRole[a.kind],
          needsReview:
            (!!a.editedAt || a.actionKey.startsWith("manual:")) &&
            a.sourceVersion !== context.version &&
            a.state === "pending" &&
            !!blockedReason(a, context)?.startsWith("New case information"),
          blockedReason: blockedReason(a, context),
          replyReceived: !!reply,
          replyId: reply?.id ?? null,
          replyHandled: !!reply && a.handledReplyId === reply.id,
        };
      }),
    gmailConnected: context.mailboxConnected,
  };
}
export async function persistActionPlan(
  db: AppDatabase,
  userId: string,
  requestId: string,
  sourceVersion: string,
  plan: PlannedAction[],
) {
  const context = await actionContext(db, userId, requestId);
  if (context.version !== sourceVersion)
    throw new Error("Case changed during analysis. Regenerate the plan.");
  const now = Date.now();
  await db
    .update(requestActions)
    .set({ disposition: "open" })
    .where(
      and(
        scope(userId, requestId),
        eq(requestActions.disposition, "deferred"),
        sql`(${requestActions.followUpAt} IS NULL OR ${requestActions.followUpAt} <= ${now})`,
      ),
    );
  type BatchItem = Parameters<AppDatabase["batch"]>[0][number];
  const statements: [BatchItem, ...BatchItem[]] = [
    db
      .update(requestActions)
      .set({ active: false })
      .where(
        and(
          scope(userId, requestId),
          eq(requestActions.state, "pending"),
          eq(requestActions.disposition, "open"),
          sql`${requestActions.actionKey} NOT LIKE 'manual:%'`,
        ),
      ),
  ];
  const seen = new Set<string>();
  for (const a of plan) {
    const recipient = context.participants.find(
      (p) => p.email.toLowerCase() === a.recipientEmail && p.role === actionRole[a.kind],
    );
    const quote = context.quotes.find((q) => q.id === a.quoteId);
    const recipientEmail = recipient?.email.toLowerCase() ?? null;
    const quoteId = quote?.id ?? null;
    const purpose =
      a.kind === "acknowledge_tenant" || a.kind === "request_details" ? "tenant_intake" : a.kind;
    const baseKey = `property${context.request.propertyId}:${purpose}:${recipientEmail ?? actionRole[a.kind]}:${quoteId ?? "none"}`;
    const prior = await db.select().from(requestActions).where(scope(userId, requestId));
    const related = prior.filter(
      (r) => r.actionKey === baseKey || r.actionKey.startsWith(`${baseKey}:followup:`),
    );
    if (
      related.some(
        (r) => r.state === "sending" || (r.state === "sent" && r.sourceVersion === sourceVersion),
      )
    )
      continue;
    const pending = related.find((r) => r.state === "pending");
    const key =
      pending?.actionKey ??
      (related.some((r) => r.state === "sent") ? `${baseKey}:followup:${sourceVersion}` : baseKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = (
      await db
        .select()
        .from(requestActions)
        .where(and(scope(userId, requestId), eq(requestActions.actionKey, key)))
    )[0];
    if (existing) {
      if (existing.state !== "pending" || existing.disposition !== "open") continue;
      statements.push(
        db
          .update(requestActions)
          .set({
            active: true,
            kind: a.kind,
            title: a.title,
            reason: a.reason,
            sourceVersion: existing.editedAt ? existing.sourceVersion : sourceVersion,
            ...(!existing.editedAt ? { subject: a.subject, body: a.body } : {}),
          })
          .where(and(eq(requestActions.id, existing.id), eq(requestActions.state, "pending"))),
      );
    } else
      statements.push(
        db
          .insert(requestActions)
          .values({
            id: crypto.randomUUID(),
            userId,
            requestId,
            actionKey: key,
            kind: a.kind,
            title: a.title,
            reason: a.reason,
            recipientEmail,
            quoteId,
            subject: a.subject,
            body: a.body,
            sourceVersion,
            operationId: crypto.randomUUID(),
            createdAt: now,
          })
          .onConflictDoNothing(),
      );
  }
  await db.batch(statements);
}
export async function saveActionDraft(
  db: AppDatabase,
  userId: string,
  id: string,
  draft: ActionDraft,
  reviewedVersion?: string,
) {
  const [current] = await db
    .select()
    .from(requestActions)
    .where(and(eq(requestActions.userId, userId), eq(requestActions.id, id)));
  if (!current) throw new Error("Action not found");
  if (reviewedVersion) {
    const context = await actionContext(db, userId, current.requestId);
    if (reviewedVersion !== context.version)
      throw new Error("Case changed. Refresh and review again.");
  }
  await resolveAttachments(
    db,
    userId,
    current.requestId,
    draft.attachmentIds ?? JSON.parse(current.attachmentIds),
  );
  const [row] = await db
    .update(requestActions)
    .set({
      subject: draft.subject,
      body: draft.body,
      attachmentIds: JSON.stringify(draft.attachmentIds ?? JSON.parse(current.attachmentIds)),
      editedAt: Date.now(),
      ...(reviewedVersion ? { sourceVersion: reviewedVersion } : {}),
    })
    .where(
      and(
        eq(requestActions.userId, userId),
        eq(requestActions.id, id),
        eq(requestActions.state, "pending"),
        eq(requestActions.active, true),
        sql`${requestActions.disposition} NOT IN ('done','skipped')`,
      ),
    )
    .returning();
  if (!row) throw new Error("Action cannot be edited. Refresh the plan.");
  return row;
}
export async function sendPlannedAction(
  db: AppDatabase,
  userId: string,
  id: string,
  draft: ActionDraft,
  deliver: (input: {
    operationId: string;
    requestId: string;
    to: string;
    subject: string;
    body: string;
    attachmentIds?: string[];
  }) => Promise<void>,
) {
  const condition = and(eq(requestActions.userId, userId), eq(requestActions.id, id));
  let [action] = await db.select().from(requestActions).where(condition);
  if (!action) throw new Error("Action not found");
  if (action.state === "sent") return;
  if (action.state === "sending") {
    const [previous] = await db
      .select()
      .from(mailSendOperations)
      .where(
        and(
          eq(mailSendOperations.userId, userId),
          eq(mailSendOperations.operationId, action.operationId),
        ),
      );
    if (previous?.state === "failed") {
      await db
        .update(requestActions)
        .set({ state: "pending", operationId: crypto.randomUUID() })
        .where(
          and(
            condition,
            eq(requestActions.state, "sending"),
            eq(requestActions.operationId, action.operationId),
          ),
        );
      throw new Error(
        "The previous send was rejected. The draft is unlocked; review it before retrying.",
      );
    }
  }
  const context = await actionContext(db, userId, action.requestId);
  if (action.state === "pending") {
    if (!action.active) throw new Error("This action is no longer in the current plan");
    const blocked = blockedReason(action, context);
    if (blocked) throw new Error(blocked);
    await resolveAttachments(
      db,
      userId,
      action.requestId,
      draft.attachmentIds ?? JSON.parse(action.attachmentIds),
    );
    const [claimed] = await db
      .update(requestActions)
      .set({
        state: "sending",
        subject: draft.subject,
        body: draft.body,
        attachmentIds: JSON.stringify(draft.attachmentIds ?? JSON.parse(action.attachmentIds)),
        editedAt: Date.now(),
      })
      .where(
        and(
          condition,
          eq(requestActions.state, "pending"),
          eq(requestActions.active, true),
          eq(requestActions.sourceVersion, context.version),
        ),
      )
      .returning();
    if (!claimed) throw new Error("Action is already being processed. Refresh and retry.");
    action = claimed;
  }
  const [operation] = await db
    .select()
    .from(mailSendOperations)
    .where(
      and(
        eq(mailSendOperations.userId, userId),
        eq(mailSendOperations.operationId, action.operationId),
      ),
    );
  if (!operation || operation.state === "failed") {
    const blocked = blockedReason({ ...action, state: "pending" }, context);
    if (blocked) throw new Error(blocked);
  }
  if (!action.recipientEmail) throw new Error("Recipient missing");
  // A retry must reuse both the operation ID and exact stored message, even after
  // a lost response. A sending action stays locked until delivery is reconciled.
  try {
    await deliver({
      operationId: action.operationId,
      requestId: action.requestId,
      to: action.recipientEmail,
      subject: action.subject,
      body: action.body,
      ...(JSON.parse(action.attachmentIds).length
        ? { attachmentIds: JSON.parse(action.attachmentIds) }
        : {}),
    });
  } catch (error) {
    const [latest] = await db
      .select()
      .from(mailSendOperations)
      .where(
        and(
          eq(mailSendOperations.userId, userId),
          eq(mailSendOperations.operationId, action.operationId),
        ),
      );
    // No send operation means delivery never started. Definite rejection is also safe to unlock.
    if (!latest || latest.state === "failed") {
      await db
        .update(requestActions)
        .set({ state: "pending", operationId: crypto.randomUUID() })
        .where(
          and(
            condition,
            eq(requestActions.state, "sending"),
            eq(requestActions.operationId, action.operationId),
          ),
        );
    }
    throw error;
  }
  const siblings = await db.select().from(requestActions).where(scope(userId, action.requestId));
  const pending = siblings.filter(
    (a) =>
      a.id !== id &&
      a.active &&
      (a.state === "pending" || a.state === "sending") &&
      !["done", "skipped"].includes(a.disposition),
  );
  const replyPlan = await listActionPlan(db, userId, action.requestId);
  const waiters = [
    ...new Set(
      siblings
        .filter((a) => (a.id === id || a.state === "sent") && expectsReply(a.kind))
        .filter((a) => !replyPlan.actions.find((p) => p.id === a.id)?.replyReceived)
        .map((a) => actionRole[a.kind]),
    ),
  ];
  const now = Date.now();
  await db.batch([
    db
      .insert(requestEvents)
      .select(
        sql`SELECT NULL, ${userId}, ${action.requestId}, ${now}, 'status', ${`Action email sent: ${action.title} → ${action.recipientEmail}`}, 'Property Manager' WHERE EXISTS (SELECT 1 FROM request_actions WHERE user_id=${userId} AND id=${id} AND state='sending')`,
      ),
    db
      .update(requestActions)
      .set({ state: "sent", sentAt: now })
      .where(and(condition, eq(requestActions.state, "sending"))),
    db
      .update(repairRequests)
      .set({
        boardColumn: pending.length || !waiters.length ? "Action Needed" : "Waiting",
        status: pending.length
          ? "Actions remaining"
          : waiters.length
            ? "Waiting for replies"
            : "Review next repair step",
        waitingOn: pending.length ? "Property Manager" : waiters.join(" · ") || "Property Manager",
        nextAction: pending[0]?.title ?? "Review replies and continue the repair workflow",
        lastUpdate: "Just now",
      })
      .where(
        and(
          eq(repairRequests.userId, userId),
          eq(repairRequests.id, action.requestId),
          ne(repairRequests.boardColumn, "Completed"),
        ),
      ),
  ]);
}
