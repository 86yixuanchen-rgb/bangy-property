import { appointmentWindow, noAppointmentConflict } from "./appointment-rules.server";
import { resolveAttachments } from "./mail-attachments.server";
import { createServerFn } from "@tanstack/react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  repairRequests,
  requestActions,
  requestEvents,
  requestParticipants,
  requestQuotes,
  emailMessages,
  caseClosures,
  quoteDecisions,
  caseAttachments,
} from "@/db/schema";
import type { AppDatabase } from "./db.server";
import { actionContext, listActionPlan } from "./incident-actions.server";
import type { ActionKind } from "./incident-action-types";
const requestId = z.string().regex(/^REQ-\d+$/);
async function deps() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const { getDb } = await import("./db.server");
  return { db: await getDb(), userId };
}
async function event(db: AppDatabase, userId: string, id: string, active = true) {
  const [r] = await db
    .select()
    .from(repairRequests)
    .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, id)));
  if (!r) throw new Error("Event not found");
  if (active && r.boardColumn === "Completed")
    throw new Error("Reopen the event before changing it.");
  return r;
}
function note(
  db: AppDatabase,
  userId: string,
  id: string,
  text: string,
  kind: "note" | "status" | "quote" | "appointment" = "note",
) {
  return db.insert(requestEvents).values({
    userId,
    requestId: id,
    at: Date.now(),
    kind,
    text,
    actor: "Property Manager",
  });
}
const roleKind: Record<string, ActionKind> = {
  Tenant: "contact_tenant",
  Landlord: "contact_landlord",
  "Repair Team": "contact_team",
  "Property Manager": "contact_pm",
};
async function draft(
  db: AppDatabase,
  userId: string,
  id: string,
  email: string,
  subject: string,
  body: string,
  key: string,
  attachmentIds: string[] = [],
) {
  const context = await actionContext(db, userId, id);
  if (!context.request.propertyId)
    throw new Error("Link a property before preparing contact emails.");
  const person = context.participants.find((p) => p.email.toLowerCase() === email.toLowerCase());
  if (!person) throw new Error("Select a contact linked to this event.");
  const kind = roleKind[person.role]!;
  await db
    .insert(requestActions)
    .values({
      id: crypto.randomUUID(),
      userId,
      requestId: id,
      actionKey: `manual:${key}`,
      kind,
      title: subject.slice(0, 120),
      reason: "Prepared by the property manager. Review before sending.",
      recipientEmail: person.email.toLowerCase(),
      subject,
      body,
      attachmentIds: JSON.stringify(attachmentIds),
      sourceVersion: context.version,
      operationId: crypto.randomUUID(),
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
}
export const createContactDraft = createServerFn({ method: "POST" })
  .validator(
    z.object({
      requestId,
      email: z.string().email(),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20000),
      operationId: z.string().uuid(),
      attachmentIds: z.array(z.string().uuid()).max(5).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await event(db, userId, data.requestId);
    await resolveAttachments(db, userId, data.requestId, data.attachmentIds);
    await draft(
      db,
      userId,
      data.requestId,
      data.email,
      data.subject,
      data.body,
      data.operationId,
      data.attachmentIds,
    );
    return { ok: true };
  });
export const manageAction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      operation: z.enum([
        "skip",
        "done",
        "defer",
        "restore",
        "followup",
        "clear_followup",
        "reply_done",
      ]),
      reason: z.string().trim().max(1000).default(""),
      dueAt: z.number().int().optional(),
      replyId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [a] = await db
      .select()
      .from(requestActions)
      .where(and(eq(requestActions.userId, userId), eq(requestActions.id, data.id)));
    if (!a) throw new Error("Action not found");
    await event(db, userId, a.requestId);
    if (a.state === "sending") throw new Error("Check delivery before changing this action.");
    if (["skip", "done", "defer"].includes(data.operation) && !data.reason)
      throw new Error("Record a reason or what was completed.");
    if (["defer", "followup"].includes(data.operation) && (!data.dueAt || data.dueAt <= Date.now()))
      throw new Error("Choose a future follow-up time.");
    if (["skip", "done", "defer", "restore"].includes(data.operation) && a.state !== "pending")
      throw new Error("Sent emails cannot be marked as unsent work.");
    if (data.operation === "reply_done") {
      const plan = await listActionPlan(db, userId, a.requestId);
      const current = plan.actions.find((p) => p.id === a.id);
      if (!data.replyId || current?.replyId !== data.replyId)
        throw new Error("The reply changed. Refresh and review the latest reply.");
    }
    const disposition =
      data.operation === "skip"
        ? "skipped"
        : data.operation === "done"
          ? "done"
          : data.operation === "defer"
            ? "deferred"
            : data.operation === "restore" ||
                (data.operation === "clear_followup" && a.disposition === "deferred")
              ? "open"
              : a.disposition;
    await db.batch([
      db
        .update(requestActions)
        .set({
          disposition,
          dispositionNote: data.reason || a.dispositionNote,
          active: true,
          ...(["defer", "followup"].includes(data.operation)
            ? { followUpAt: data.dueAt }
            : ["restore", "clear_followup", "reply_done", "skip", "done"].includes(data.operation)
              ? { followUpAt: null }
              : {}),
          ...(data.operation === "reply_done" ? { handledReplyId: data.replyId } : {}),
        })
        .where(
          and(
            eq(requestActions.userId, userId),
            eq(requestActions.id, a.id),
            eq(requestActions.state, a.state),
          ),
        ),
      note(
        db,
        userId,
        a.requestId,
        `Action ${data.operation}: ${a.title}. ${data.reason}${data.dueAt ? ` Follow up: ${new Date(data.dueAt).toISOString()}` : ""}`,
        data.operation === "done" ? "note" : "status",
      ),
    ]);
    return { ok: true };
  });
export const listFollowUps = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = await deps();
  const rows = await db
    .select({
      id: requestActions.id,
      requestId: requestActions.requestId,
      title: requestActions.title,
      dueAt: requestActions.followUpAt,
      address: repairRequests.address,
    })
    .from(requestActions)
    .innerJoin(
      repairRequests,
      and(
        eq(repairRequests.userId, requestActions.userId),
        eq(repairRequests.id, requestActions.requestId),
      ),
    )
    .where(
      and(
        eq(requestActions.userId, userId),
        sql`${requestActions.followUpAt} IS NOT NULL`,
        sql`${repairRequests.boardColumn} != 'Completed'`,
        sql`${requestActions.disposition} NOT IN ('done','skipped')`,
      ),
    );
  return rows.sort((a, b) => a.dueAt! - b.dueAt!);
});
export const recordQuoteDecision = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int(),
      decision: z.enum(["Approved", "Rejected"]),
      method: z.enum(["email", "phone"]),
      evidence: z.string().trim().min(5).max(2000),
      emailId: z.string().optional(),
      amount: z.number().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [q] = await db
      .select()
      .from(requestQuotes)
      .where(and(eq(requestQuotes.userId, userId), eq(requestQuotes.id, data.id)));
    if (!q) throw new Error("Quote not found");
    await event(db, userId, q.requestId);
    if (Math.round(data.amount * 100) !== q.amountCents)
      throw new Error("Quote amount changed. Review it again.");
    if (q.supersededAt || q.status !== "Pending")
      throw new Error("This quote already has a decision.");
    if (data.method === "email") {
      const [m] = await db
        .select()
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.userId, userId),
            eq(emailMessages.id, data.emailId ?? ""),
            eq(emailMessages.requestId, q.requestId),
          ),
        );
      const people = await db
        .select()
        .from(requestParticipants)
        .where(
          and(
            eq(requestParticipants.userId, userId),
            eq(requestParticipants.requestId, q.requestId),
            eq(requestParticipants.role, "Landlord"),
          ),
        );
      if (
        !m ||
        m.sent ||
        m.trashed ||
        !people.some((p) => p.email.toLowerCase() === m.fromEmail.toLowerCase())
      )
        throw new Error("Select a linked email from the landlord.");
    }
    await db.batch([
      db.insert(quoteDecisions).values({
        id: crypto.randomUUID(),
        userId,
        requestId: q.requestId,
        quoteId: q.id,
        decision: data.decision,
        method: data.method,
        evidence: data.evidence,
        emailId: data.emailId ?? null,
        amountCents: q.amountCents,
        at: Date.now(),
      }),
      db
        .update(requestQuotes)
        .set({ status: data.decision })
        .where(
          and(
            eq(requestQuotes.userId, userId),
            eq(requestQuotes.id, q.id),
            eq(requestQuotes.status, "Pending"),
          ),
        ),
      note(
        db,
        userId,
        q.requestId,
        `Landlord decision recorded: ${data.decision}, ${q.supplier}, $${data.amount.toFixed(2)}. Via ${data.method}. ${data.evidence}${data.emailId ? ` Email: ${data.emailId}` : ""}`,
        "quote",
      ),
    ]);
    return { ok: true };
  });
export const closeCase = createServerFn({ method: "POST" })
  .validator(
    z.object({
      requestId,
      type: z.enum(["repair_completed", "non_repair"]),
      outcome: z.string().trim().min(5).max(2000),
      cost: z.number().min(0).max(10000000).nullable(),
      tenantConfirmation: z.enum(["confirmed", "not_required", "not_confirmed"]),
      confirmationNote: z.string().trim().max(1000),
      retainFutureVisits: z.boolean().optional(),
      futureVisitReason: z.string().trim().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const r = await event(db, userId, data.requestId);
    if (data.type === "repair_completed" && !r.propertyId)
      throw new Error("Link a property before closing a repair.");
    if (data.type === "repair_completed" && (data.cost === null || !data.confirmationNote))
      throw new Error(
        "Record actual cost and tenant confirmation details (or why confirmation is unavailable).",
      );
    const busy = await db
      .select()
      .from(requestActions)
      .where(
        and(
          eq(requestActions.userId, userId),
          eq(requestActions.requestId, r.id),
          eq(requestActions.state, "sending"),
        ),
      );
    if (busy.length) throw new Error("Resolve uncertain deliveries before closing this event.");
    const cancellationDrafts = await db
      .select()
      .from(requestActions)
      .where(
        and(
          eq(requestActions.userId, userId),
          eq(requestActions.requestId, r.id),
          eq(requestActions.state, "pending"),
          eq(requestActions.active, true),
          sql`${requestActions.disposition} NOT IN ('done','skipped')`,
          sql`${requestActions.actionKey} LIKE 'manual:cancel:%'`,
        ),
      );
    if (cancellationDrafts.length)
      throw new Error(
        "Review cancellation notifications before closure. Send them or explicitly mark them not required with a reason.",
      );
    const future = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.userId, userId),
          eq(appointments.requestId, r.id),
          sql`${appointments.cancelledAt} IS NULL`,
          sql`${appointments.startsAt} > ${Date.now()}`,
        ),
      );
    if (future.length && (!data.retainFutureVisits || !data.futureVisitReason?.trim()))
      throw new Error(
        "Cancel future visits or explicitly retain them with a reason before closing.",
      );
    await db.batch([
      db.insert(caseClosures).values({
        id: crypto.randomUUID(),
        userId,
        requestId: r.id,
        type: data.type,
        outcome: data.outcome,
        costCents: data.cost === null ? null : Math.round(data.cost * 100),
        tenantConfirmation: `${data.tenantConfirmation}: ${data.confirmationNote}${data.retainFutureVisits ? ` Future visits retained: ${data.futureVisitReason}` : ""}`,
        at: Date.now(),
      }),
      db
        .update(repairRequests)
        .set({
          boardColumn: "Completed",
          status: data.type === "non_repair" ? "Closed · not a repair" : "Repair completed",
          waitingOn: "—",
          nextAction: "Case closed",
          lastUpdate: "Just now",
        })
        .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, r.id))),
      db
        .update(requestActions)
        .set({ followUpAt: null })
        .where(and(eq(requestActions.userId, userId), eq(requestActions.requestId, r.id))),
      note(
        db,
        userId,
        r.id,
        `Case closed (${data.type}). ${data.outcome}. Cost: ${data.cost ?? "N/A"}. Tenant: ${data.tenantConfirmation}. ${data.confirmationNote}${data.retainFutureVisits ? ` Future visits retained: ${data.futureVisitReason}` : ""}`,
      ),
    ]);
    return { ok: true };
  });
export const rescheduleVisit = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int(),
      previousStart: z.number().int(),
      startsAt: z.number().int(),
      endsAt: z.number().int().optional(),
      attendeeEmails: z.array(z.string().trim().toLowerCase().email()).max(30).optional(),
      title: z.string().trim().min(1).max(200).optional(),
      notes: z.string().max(2000).optional(),
      location: z.string().trim().min(1).max(300),
      reason: z.string().trim().min(3).max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [a] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.userId, userId), eq(appointments.id, data.id)));
    if (!a?.propertyId) throw new Error("Select a property appointment.");
    if (a.requestId) await event(db, userId, a.requestId);
    if (a.cancelledAt)
      throw new Error("Cancelled appointments cannot be rescheduled. Book a new visit.");
    if (data.startsAt <= Date.now()) throw new Error("Choose a future appointment time.");
    const endsAt = appointmentWindow(
      data.startsAt,
      data.endsAt ?? data.startsAt + ((a.endsAt ?? a.startsAt + 3600000) - a.startsAt),
    );
    const attendees = data.attendeeEmails ?? (JSON.parse(a.attendeeEmails) as string[]);
    const [updated] = await db
      .update(appointments)
      .set({
        startsAt: data.startsAt,
        endsAt,
        attendeeEmails: JSON.stringify(attendees),
        location: data.location,
        ...(data.title ? { title: data.title } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      })
      .where(
        and(
          eq(appointments.userId, userId),
          eq(appointments.id, a.id),
          eq(appointments.startsAt, data.previousStart),
          noAppointmentConflict(userId, a.propertyId, data.startsAt, endsAt, attendees, a.id),
          sql`${appointments.cancelledAt} IS NULL`,
        ),
      )
      .returning();
    if (!updated)
      throw new Error(
        "Appointment changed or conflicts with another booking. Refresh before rescheduling.",
      );
    if (!a.requestId) return { ok: true, drafts: 0 };
    await db
      .update(requestActions)
      .set({ active: false, followUpAt: null })
      .where(
        and(
          eq(requestActions.userId, userId),
          eq(requestActions.requestId, a.requestId),
          eq(requestActions.state, "pending"),
          sql`${requestActions.actionKey} LIKE ${`manual:visit:${a.id}:%`}`,
        ),
      );
    await note(
      db,
      userId,
      a.requestId,
      `Visit rescheduled from ${new Date(a.startsAt).toISOString()} to ${new Date(data.startsAt).toISOString()}. ${data.reason}`,
      "appointment",
    );
    const context = await actionContext(db, userId, a.requestId);
    let count = 0;
    for (const p of context.participants.filter(
      (p) => p.role === "Tenant" || p.role === "Repair Team",
    )) {
      await draft(
        db,
        userId,
        a.requestId,
        p.email,
        `Updated repair visit: ${context.request.title}`,
        `Hi ${p.name},\n\nThe repair visit for ${context.request.address} has been rescheduled.\nNew time: ${new Date(data.startsAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney time)\nLocation: ${data.location}\nReason: ${data.reason}\n\nPlease let us know if this time does not work for you.`,
        `visit:${a.id}:${data.startsAt}:${p.email}`,
      );
      count++;
    }
    return { ok: true, drafts: count };
  });
export const getCaseRecords = createServerFn({ method: "GET" })
  .validator(z.object({ requestId }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await event(db, userId, data.requestId, false);
    const [closures, decisions, files] = await Promise.all([
      db
        .select()
        .from(caseClosures)
        .where(and(eq(caseClosures.userId, userId), eq(caseClosures.requestId, data.requestId)))
        .orderBy(desc(caseClosures.at)),
      db
        .select()
        .from(quoteDecisions)
        .where(
          and(eq(quoteDecisions.userId, userId), eq(quoteDecisions.requestId, data.requestId)),
        ),
      db
        .select({
          id: caseAttachments.id,
          name: caseAttachments.name,
          mime: caseAttachments.mime,
          category: caseAttachments.category,
          size: caseAttachments.size,
          at: caseAttachments.at,
          trashedAt: caseAttachments.trashedAt,
          quoteId: caseAttachments.quoteId,
        })
        .from(caseAttachments)
        .where(
          and(eq(caseAttachments.userId, userId), eq(caseAttachments.requestId, data.requestId)),
        ),
    ]);
    return { closures, decisions, files };
  });
export const uploadCaseFile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      requestId,
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
      category: z.enum(["Damage photo", "Quote", "Completion photo", "Other"]),
      content: z.string().max(1400000),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await event(db, userId, data.requestId);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    } catch {
      throw new Error("Invalid file data");
    }
    if (!bytes.length || bytes.length > 1024 * 1024)
      throw new Error("Files must be 1 MB or smaller.");
    const head = Array.from(bytes.slice(0, 12));
    const text = new TextDecoder().decode(bytes.slice(0, 12));
    const valid =
      data.mime === "application/pdf"
        ? text.startsWith("%PDF-")
        : data.mime === "image/png"
          ? head.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : data.mime === "image/jpeg"
            ? head[0] === 255 && head[1] === 216 && head[2] === 255
            : text.startsWith("RIFF") && text.slice(8) === "WEBP";
    if (!valid) throw new Error("File contents do not match its supported format.");
    const [total] = await db
      .select({ size: sql<number>`coalesce(sum(${caseAttachments.size}),0)` })
      .from(caseAttachments)
      .where(
        and(eq(caseAttachments.userId, userId), eq(caseAttachments.requestId, data.requestId)),
      );
    if (total!.size + bytes.length > 20 * 1024 * 1024)
      throw new Error("This event has reached its 20 MB file limit.");
    await db
      .insert(caseAttachments)
      .values({ ...data, userId, size: bytes.length, at: Date.now() })
      .onConflictDoNothing();
    return { ok: true };
  });
export const getCaseFile = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [file] = await db
      .select()
      .from(caseAttachments)
      .where(and(eq(caseAttachments.userId, userId), eq(caseAttachments.id, data.id)));
    if (!file) throw new Error("File not found");
    return file;
  });
export const getPropertyContactHistory = createServerFn({ method: "GET" })
  .validator(z.object({ propertyId: z.number().int().positive(), email: z.string().email() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const events = await db
      .select()
      .from(repairRequests)
      .where(
        and(eq(repairRequests.userId, userId), eq(repairRequests.propertyId, data.propertyId)),
      );
    const people = await db
      .select()
      .from(requestParticipants)
      .where(
        and(
          eq(requestParticipants.userId, userId),
          eq(requestParticipants.email, data.email.toLowerCase()),
        ),
      );
    const relevant = events.filter((r) => people.some((p) => p.requestId === r.id));
    const emails = await db.select().from(emailMessages).where(eq(emailMessages.userId, userId));
    return {
      events: relevant.map((r) => ({
        id: r.id,
        title: r.title,
        completed: r.boardColumn === "Completed",
      })),
      emails: emails
        .filter(
          (m) =>
            relevant.some((r) => r.id === m.requestId) &&
            (m.fromEmail.toLowerCase() === data.email.toLowerCase() ||
              m.toEmails
                .split(",")
                .some((email) => email.trim().toLowerCase() === data.email.toLowerCase())),
        )
        .map((m) => ({
          id: m.id,
          requestId: m.requestId,
          subject: m.subject,
          body: m.body,
          at: m.receivedAt,
          from: m.fromEmail,
        }))
        .sort((a, b) => b.at - a.at),
    };
  });

export {
  deps as workflowDeps,
  event as requireActiveEvent,
  note as workflowNote,
  draft as prepareWorkflowDraft,
};
