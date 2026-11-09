import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  properties,
  requestActions,
  requestQuotes,
  requestParticipants,
  repairRequests,
  requestEvents,
  caseAttachments,
  notificationReads,
  emailMessages,
} from "@/db/schema";
import {
  workflowDeps as deps,
  requireActiveEvent as event,
  workflowNote as note,
  prepareWorkflowDraft as draft,
} from "./case-workflow.functions";
import { actionContext } from "./incident-actions.server";
import { propertyContacts } from "./property-contacts";
const requestId = z.string().regex(/^REQ-\d+$/);
export const cancelVisit = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int(), reason: z.string().trim().min(3).max(1000) }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [a] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.userId, userId), eq(appointments.id, data.id)));
    if (!a) throw new Error("Appointment not found");
    if (a.requestId) await event(db, userId, a.requestId);
    if (!a.cancelledAt) {
      await db
        .update(appointments)
        .set({ cancelledAt: Date.now(), cancelReason: data.reason })
        .where(
          and(
            eq(appointments.userId, userId),
            eq(appointments.id, a.id),
            isNull(appointments.cancelledAt),
          ),
        );
      if (a.requestId) {
        await note(
          db,
          userId,
          a.requestId,
          `Visit cancelled: ${a.title}, ${new Date(a.startsAt).toISOString()}. ${data.reason}`,
          "appointment",
        );
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
      }
    }
    let count = 0;
    if (a.requestId) {
      const context = await actionContext(db, userId, a.requestId);
      for (const p of context.participants.filter(
        (p) => p.role === "Tenant" || p.role === "Repair Team",
      )) {
        await draft(
          db,
          userId,
          a.requestId,
          p.email,
          `Cancelled visit: ${a.title}`,
          `Hi ${p.name},\n\nThe visit for ${context.request.address} on ${new Date(a.startsAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney time) has been cancelled.\nReason: ${a.cancelReason ?? data.reason}\n\nPlease do not attend this appointment. We will confirm any replacement arrangements separately.`,
          `cancel:${a.id}:${p.email}`,
        );
        count++;
      }
    }
    return { ok: true, drafts: count };
  });
export const reviseQuote = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int(),
      supplier: z.string().trim().min(1).max(100),
      amount: z.number().positive().max(10000000),
      description: z.string().max(500),
      reason: z.string().trim().min(3).max(1000),
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
    if (q.supersededAt) throw new Error("This quote already has a newer version.");
    await db.batch([
      db.insert(requestQuotes).values({
        userId,
        requestId: q.requestId,
        supplier: data.supplier,
        amountCents: Math.round(data.amount * 100),
        description: data.description,
        status: "Pending",
        createdAt: Date.now(),
        supersedesId: q.id,
      }),
      db
        .update(requestQuotes)
        .set({ supersededAt: Date.now() })
        .where(and(eq(requestQuotes.userId, userId), eq(requestQuotes.id, q.id))),
      db
        .update(requestActions)
        .set({ active: false, followUpAt: null })
        .where(
          and(
            eq(requestActions.userId, userId),
            eq(requestActions.quoteId, q.id),
            eq(requestActions.state, "pending"),
          ),
        ),
      note(
        db,
        userId,
        q.requestId,
        `Quote #${q.id} replaced with a new pending version ($${data.amount.toFixed(2)}). Previous decision retained. Reason: ${data.reason}`,
        "quote",
      ),
    ]);
    return { ok: true };
  });
export const updateCaseFile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      category: z.enum(["Damage photo", "Quote", "Completion photo", "Other"]),
      quoteId: z.number().int().positive().nullable(),
      trash: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [f] = await db
      .select()
      .from(caseAttachments)
      .where(and(eq(caseAttachments.userId, userId), eq(caseAttachments.id, data.id)));
    if (!f) throw new Error("File not found");
    await event(db, userId, f.requestId, false);
    if (data.quoteId) {
      const [q] = await db
        .select()
        .from(requestQuotes)
        .where(
          and(
            eq(requestQuotes.userId, userId),
            eq(requestQuotes.requestId, f.requestId),
            eq(requestQuotes.id, data.quoteId),
          ),
        );
      if (!q) throw new Error("Choose a quote from this event.");
    }
    await db
      .update(caseAttachments)
      .set({
        name: data.name,
        category: data.category,
        quoteId: data.quoteId,
        trashedAt: data.trash ? (f.trashedAt ?? Date.now()) : null,
      })
      .where(and(eq(caseAttachments.userId, userId), eq(caseAttachments.id, f.id)));
    return { ok: true };
  });
export const archiveProperty = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive(), archive: z.boolean() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [p] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.userId, userId), eq(properties.id, data.id)));
    if (!p) throw new Error("Property not found");
    if (data.archive) {
      const visits = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.userId, userId),
            eq(appointments.propertyId, p.id),
            isNull(appointments.cancelledAt),
            sql`${appointments.startsAt} > ${Date.now()}`,
          ),
        );
      if (visits.length) throw new Error("Cancel upcoming visits before archiving this property.");
      const active = await db
        .select()
        .from(repairRequests)
        .where(
          and(
            eq(repairRequests.userId, userId),
            eq(repairRequests.propertyId, p.id),
            sql`${repairRequests.boardColumn} != 'Completed'`,
          ),
        );
      if (active.length)
        throw new Error(
          `Resolve or reassign ${active.length} active event(s) before archiving this property.`,
        );
    }
    await db
      .update(properties)
      .set({ archivedAt: data.archive ? Date.now() : null })
      .where(and(eq(properties.userId, userId), eq(properties.id, p.id)));
    return { ok: true };
  });
export const previewPropertyCorrection = createServerFn({ method: "GET" })
  .validator(z.object({ requestId, propertyId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await event(db, userId, data.requestId);
    const context = await actionContext(db, userId, data.requestId);
    const [target] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.userId, userId), eq(properties.id, data.propertyId)));
    if (!target || target.archivedAt)
      throw new Error("Choose an active property in this workspace.");
    const actions = await db
      .select()
      .from(requestActions)
      .where(and(eq(requestActions.userId, userId), eq(requestActions.requestId, data.requestId)));
    const files = await db
      .select({ id: caseAttachments.id })
      .from(caseAttachments)
      .where(
        and(eq(caseAttachments.userId, userId), eq(caseAttachments.requestId, data.requestId)),
      );
    return {
      version: context.version,
      from: context.request.address,
      target,
      currentPeople: context.participants.filter((p) => p.role !== "Repair Team"),
      newPeople: propertyContacts(target),
      appointments: context.bookings.filter((a) => !a.cancelledAt && a.startsAt > Date.now())
        .length,
      quotes: context.quotes.filter((q) => !q.supersededAt).length,
      drafts: actions.filter(
        (a) => a.active && a.state === "pending" && !["done", "skipped"].includes(a.disposition),
      ).length,
      files: files.length,
      sending: actions.some((a) => a.state === "sending"),
    };
  });
export const correctProperty = createServerFn({ method: "POST" })
  .validator(
    z.object({
      requestId,
      propertyId: z.number().int().positive(),
      version: z.string(),
      targetVersion: z.string(),
      reason: z.string().trim().min(3).max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const preview = await previewPropertyCorrection({ data });
    if (preview.version !== data.version || JSON.stringify(preview.target) !== data.targetVersion)
      throw new Error("Case or property changed. Review the impact again.");
    if (preview.sending)
      throw new Error("Resolve pending deliveries before correcting the property.");
    const { db, userId } = await deps();
    const context = await actionContext(db, userId, data.requestId);
    if (context.request.propertyId === data.propertyId)
      throw new Error("This event is already linked to that property.");
    const people = preview.newPeople;
    const team = context.participants.filter((p) => p.role === "Repair Team");
    if (
      new Set([...people, ...team].map((p) => p.email.toLowerCase())).size !==
      people.length + team.length
    )
      throw new Error("Contact roles overlap. Review property contacts first.");
    await db.batch([
      db
        .update(repairRequests)
        .set({
          propertyId: data.propertyId,
          address: preview.target.address,
          boardColumn: "Action Needed",
          status: "Property corrected · review case",
          waitingOn: "Property Manager",
          nextAction: "Review contacts, quotes and generate a fresh action plan",
          aiSourceVersion: null,
        })
        .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, data.requestId))),
      db
        .delete(requestParticipants)
        .where(
          and(
            eq(requestParticipants.userId, userId),
            eq(requestParticipants.requestId, data.requestId),
            sql`${requestParticipants.role} != 'Repair Team'`,
          ),
        ),
      ...people.map((p) =>
        db.insert(requestParticipants).values({ userId, requestId: data.requestId, ...p }),
      ),
      db
        .update(appointments)
        .set({
          propertyId: data.propertyId,
          location: sql`CASE WHEN ${appointments.location} = ${context.request.address} THEN ${preview.target.address} ELSE ${appointments.location} END`,
        })
        .where(
          and(
            eq(appointments.userId, userId),
            eq(appointments.requestId, data.requestId),
            isNull(appointments.cancelledAt),
            sql`${appointments.startsAt} > ${Date.now()}`,
          ),
        ),
      db
        .update(requestQuotes)
        .set({ supersededAt: Date.now() })
        .where(
          and(
            eq(requestQuotes.userId, userId),
            eq(requestQuotes.requestId, data.requestId),
            isNull(requestQuotes.supersededAt),
          ),
        ),
      db
        .update(requestActions)
        .set({
          active: false,
          followUpAt: null,
          disposition: "skipped",
          dispositionNote: "Property corrected. Draft withdrawn.",
          actionKey: sql`${requestActions.actionKey} || ${":withdrawn:" + crypto.randomUUID()}`,
        })
        .where(
          and(
            eq(requestActions.userId, userId),
            eq(requestActions.requestId, data.requestId),
            eq(requestActions.state, "pending"),
          ),
        ),
      note(
        db,
        userId,
        data.requestId,
        `Property corrected from ${context.request.address} to ${preview.target.address}. ${data.reason}. Contacts replaced; previous quotes retained as superseded history; unsent drafts withdrawn.`,
      ),
    ]);
    return { ok: true };
  });
export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = await deps();
  const [events, actions, emails, reads] = await Promise.all([
    db.select().from(repairRequests).where(eq(repairRequests.userId, userId)),
    db.select().from(requestActions).where(eq(requestActions.userId, userId)),
    db.select().from(emailMessages).where(eq(emailMessages.userId, userId)),
    db.select().from(notificationReads).where(eq(notificationReads.userId, userId)),
  ]);
  const active = new Set(events.filter((r) => r.boardColumn !== "Completed").map((r) => r.id));
  const now = Date.now();
  const items: Array<{
    key: string;
    requestId: string;
    title: string;
    detail: string;
    at: number;
    kind: string;
  }> = [];
  for (const a of actions) {
    if (!active.has(a.requestId)) continue;
    if (a.state === "sending")
      items.push({
        key: `delivery:${a.id}:${a.operationId}`,
        requestId: a.requestId,
        title: "Check email delivery",
        detail: a.title,
        at: a.editedAt ?? a.createdAt,
        kind: "delivery",
      });
    if (
      a.active &&
      a.followUpAt &&
      a.followUpAt <= now &&
      !["done", "skipped"].includes(a.disposition)
    )
      items.push({
        key: `followup:${a.id}:${a.followUpAt}`,
        requestId: a.requestId,
        title: "Follow-up due",
        detail: a.title,
        at: a.followUpAt,
        kind: "followup",
      });
  }
  for (const m of emails) {
    if (m.requestId && active.has(m.requestId) && !m.sent && !m.trashed)
      items.push({
        key: `reply:${m.id}`,
        requestId: m.requestId,
        title: "New case email",
        detail: m.subject,
        at: m.receivedAt,
        kind: "reply",
      });
  }
  for (const r of events.filter((r) => r.boardColumn === "Action Needed"))
    items.push({
      key: `attention:${r.id}:${r.status}:${r.nextAction}`,
      requestId: r.id,
      title: "Case needs attention",
      detail: r.nextAction,
      at: 0,
      kind: "attention",
    });
  return items
    .sort((a, b) => b.at - a.at)
    .map((n) => ({ ...n, read: reads.some((r) => r.key === n.key) }));
});
export const markNotificationsRead = createServerFn({ method: "POST" })
  .validator(z.object({ keys: z.array(z.string().max(1000)).max(500) }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    if (data.keys.length)
      await db.batch(
        data.keys.map((key) =>
          db
            .insert(notificationReads)
            .values({ userId, key, at: Date.now() })
            .onConflictDoNothing(),
        ) as unknown as Parameters<typeof db.batch>[0],
      );
    return { ok: true };
  });

// Parallel recipients can still be waiting even when the case also needs PM work.
export const listWaitingCases = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = await deps();
  const { mailSendOperations } = await import("@/db/schema");
  const { expectsReply, actionRole } = await import("./incident-action-types");
  const [cases, actions, operations, inbound] = await Promise.all([
    db.select().from(repairRequests).where(eq(repairRequests.userId, userId)),
    db.select().from(requestActions).where(eq(requestActions.userId, userId)),
    db.select().from(mailSendOperations).where(eq(mailSendOperations.userId, userId)),
    db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.userId, userId),
          eq(emailMessages.sent, false),
          eq(emailMessages.trashed, false),
        ),
      ),
  ]);
  const result: Array<{ requestId: string; role: string }> = [];
  for (const r of cases.filter((r) => r.boardColumn !== "Completed")) {
    const own = actions.filter((a) => a.requestId === r.id);
    if (!own.length) {
      for (const role of ["Landlord", "Repair Team"])
        if (r.waitingOn.toLowerCase().includes(role.toLowerCase()))
          result.push({ requestId: r.id, role });
      continue;
    }
    for (const a of own.filter(
      (a) =>
        a.state === "sent" && expectsReply(a.kind) && !["done", "skipped"].includes(a.disposition),
    )) {
      const operation = operations.find((o) => o.operationId === a.operationId);
      const replied =
        operation?.threadId &&
        inbound.some(
          (m) =>
            m.requestId === r.id &&
            m.threadId === operation.threadId &&
            m.fromEmail.toLowerCase() === a.recipientEmail &&
            m.receivedAt > (a.sentAt ?? 0),
        );
      if (!replied) result.push({ requestId: r.id, role: actionRole[a.kind] });
    }
  }
  return result;
});
