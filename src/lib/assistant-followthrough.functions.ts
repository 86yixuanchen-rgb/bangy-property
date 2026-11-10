import { createServerFn } from "@tanstack/react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { getDb } from "./db.server";
import { assistantActions, resolveActionReferences } from "./assistant-actions";
import { ownedEntity, recordHref } from "./assistant-executor.server";
import { extractPropertyAddress, normalizeAddress } from "./assistant-property";
import { timeDisplay } from "./appointment-time";
import { undoReceipt } from "./assistant-followthrough.server";
async function deps() {
  const { userId } = await auth();
  if (!userId) throw Error("Unauthorized");
  return { db: await getDb(), userId };
}
export const manageConversation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      archive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const rows = await db
      .update(t.assistantSessions)
      .set({
        ...(data.title ? { title: data.title } : {}),
        ...(data.archive !== undefined ? { archivedAt: data.archive ? Date.now() : null } : {}),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(t.assistantSessions.userId, userId),
          eq(t.assistantSessions.id, data.id),
          sql`${t.assistantSessions.runId} IS NULL`,
        ),
      )
      .returning();
    if (!rows.length) throw Error("Conversation is busy or unavailable.");
    return { ok: true };
  });
export const stopAssistant = createServerFn({ method: "POST" })
  .validator(z.object({ sessionId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await db
      .update(t.assistantSessions)
      .set({ stopRequested: true, activity: "Stopping after the current operation…" })
      .where(
        and(eq(t.assistantSessions.userId, userId), eq(t.assistantSessions.id, data.sessionId)),
      );
    await db
      .update(t.assistantPlans)
      .set({ stopRequested: true })
      .where(
        and(
          eq(t.assistantPlans.userId, userId),
          eq(t.assistantPlans.sessionId, data.sessionId),
          eq(t.assistantPlans.state, "running"),
        ),
      );
    return { ok: true };
  });
export const undoAssistantChange = createServerFn({ method: "POST" })
  .validator(z.object({ stepId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    return undoReceipt(db, userId, data.stepId);
  });
export const reconcileAssistantStep = createServerFn({ method: "POST" })
  .validator(
    z.object({
      stepId: z.string().uuid(),
      recordId: z.string().min(1).optional(),
      dismiss: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [s] = await db
      .select()
      .from(t.assistantSteps)
      .where(and(eq(t.assistantSteps.userId, userId), eq(t.assistantSteps.id, data.stepId)));
    if (!s || s.state !== "uncertain" || ["email.send", "action.send"].includes(s.action))
      throw Error("Choose an uncertain non-email action.");
    const [p] = await db
      .select()
      .from(t.assistantPlans)
      .where(and(eq(t.assistantPlans.userId, userId), eq(t.assistantPlans.id, s.planId)));
    if (!p || ["running", "editing"].includes(p.state)) throw Error("Wait for the plan to finish.");
    const [lock] = await db
      .update(t.assistantPlans)
      .set({ state: "editing", revision: p.revision + 1, lockedAt: Date.now() })
      .where(
        and(
          eq(t.assistantPlans.userId, userId),
          eq(t.assistantPlans.id, p.id),
          eq(t.assistantPlans.revision, p.revision),
          eq(t.assistantPlans.state, p.state),
        ),
      )
      .returning();
    if (!lock) throw Error("Plan changed. Refresh before recovery.");
    try {
      if (data.dismiss) {
        await db
          .update(t.assistantSteps)
          .set({ state: "cancelled", error: "Outcome checked by user; no retry requested." })
          .where(
            and(
              eq(t.assistantSteps.userId, userId),
              eq(t.assistantSteps.id, s.id),
              eq(t.assistantSteps.state, "uncertain"),
            ),
          );
        return { ok: true };
      }
      const siblings = await db
        .select()
        .from(t.assistantSteps)
        .where(and(eq(t.assistantSteps.userId, userId), eq(t.assistantSteps.planId, p.id)));
      const a = resolveActionReferences(JSON.parse(s.args), (position, key) => {
        const prior = siblings.find((x) => x.position === position && x.state === "succeeded");
        if (!prior?.result) throw Error("Verify prerequisites first.");
        return JSON.parse(prior.result)[key];
      }) as Record<string, unknown>;
      const mapping: Record<string, { entity: string; keys: string[] }> = {
        "contact.save": {
          entity: "contacts",
          keys: ["email", "name", "role", ...["phone", "notes"].filter((k) => a[k] !== undefined)],
        },
        "property.update": { entity: "properties", keys: Object.keys(a).filter((k) => k !== "id") },
        "event.update": { entity: "events", keys: Object.keys(a).filter((k) => k !== "id") },
        "appointment.update": {
          entity: "appointments",
          keys: Object.keys(a).filter((k) => !["id", "reason"].includes(k)),
        },
        "property.create": { entity: "properties", keys: ["address"] },
        "event.create": { entity: "events", keys: ["title", "propertyId"] },
        "appointment.create": { entity: "appointments", keys: ["operationId"] },
        "email.draft": { entity: "actions", keys: ["actionKey"] },
      };
      const spec = mapping[s.action];
      if (!spec || !data.recordId)
        throw Error("Open the record and check the outcome. This operation needs manual review.");
      const row = await ownedEntity(db, userId, spec.entity, data.recordId);
      if (a["id"] && String(a["id"]) !== String(row["id"]))
        throw Error("Choose the original target record.");
      const expected: Record<string, unknown> = {
        ...a,
        operationId: s.id,
        actionKey: `manual:${s.id}`,
      };
      const same = (key: string) => {
        const raw = row[key === "column" ? "boardColumn" : key];
        const actual = key === "attendeeEmails" && typeof raw === "string" ? JSON.parse(raw) : raw;
        return (
          expected[key] !== undefined && JSON.stringify(actual) === JSON.stringify(expected[key])
        );
      };
      if (!spec.keys.length || !spec.keys.every(same))
        throw Error("Selected record does not match this action. Nothing changed.");
      const result = {
        summary: "Existing result verified; nothing was repeated.",
        id: row["id"],
        ...(spec.entity === "properties" ? { propertyId: row["id"] } : {}),
        ...(spec.entity === "events" ? { requestId: row["id"] } : {}),
        href: recordHref(spec.entity, row),
      };
      await db.batch([
        db
          .update(t.assistantSteps)
          .set({
            state: "succeeded",
            result: JSON.stringify(result),
            error: null,
            completedAt: Date.now(),
          })
          .where(
            and(
              eq(t.assistantSteps.userId, userId),
              eq(t.assistantSteps.id, s.id),
              eq(t.assistantSteps.state, "uncertain"),
            ),
          ),
        db
          .update(t.assistantPlans)
          .set({ revision: p.revision + 1, state: "partial" })
          .where(
            and(
              eq(t.assistantPlans.userId, userId),
              eq(t.assistantPlans.id, p.id),
              eq(t.assistantPlans.revision, p.revision),
            ),
          ),
      ]);
      return { ok: true };
    } finally {
      await db
        .update(t.assistantPlans)
        .set({ state: "partial" })
        .where(
          and(
            eq(t.assistantPlans.userId, userId),
            eq(t.assistantPlans.id, p.id),
            eq(t.assistantPlans.revision, p.revision + 1),
          ),
        );
    }
  });
export const availableAppointmentSlots = createServerFn({ method: "GET" })
  .validator(
    z.object({
      propertyId: z.number().positive().optional(),
      appointmentId: z.number().positive().optional(),
      startsAt: z.number(),
      endsAt: z.number(),
      attendeeEmails: z.array(z.string().email()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const existing = data.appointmentId
      ? await ownedEntity(db, userId, "appointments", data.appointmentId)
      : null;
    const propertyId = data.propertyId ?? Number(existing?.["propertyId"]);
    await ownedEntity(db, userId, "properties", propertyId);
    const duration = data.endsAt - data.startsAt;
    if (duration <= 0 || duration > 86400000) throw Error("Choose a duration of up to 24 hours.");
    const emails = new Set(
      (
        data.attendeeEmails ??
        (existing ? (JSON.parse(String(existing["attendeeEmails"])) as string[]) : [])
      ).map((e) => e.toLowerCase()),
    );
    const bookings = await db
      .select()
      .from(t.appointments)
      .where(and(eq(t.appointments.userId, userId), sql`${t.appointments.cancelledAt} IS NULL`));
    const relevant = bookings.filter(
      (b) =>
        b.id !== data.appointmentId &&
        (b.propertyId === propertyId ||
          (JSON.parse(b.attendeeEmails) as string[]).some((e) => emails.has(e.toLowerCase()))),
    );
    const slots: Array<{ startsAt: number; endsAt: number }> = [];
    for (let i = 0; i < 14 * 48 && slots.length < 5; i++) {
      const start = data.startsAt + i * 1800000,
        end = start + duration;
      const wall = timeDisplay(start),
        hour = Number(wall.slice(11, 13));
      if (
        start < Date.now() ||
        hour < 8 ||
        hour >= 18 ||
        timeDisplay(end).slice(0, 10) !== wall.slice(0, 10) ||
        timeDisplay(end).slice(11, 16) > "18:00"
      )
        continue;
      if (!relevant.some((b) => b.startsAt < end && (b.endsAt ?? b.startsAt + 3600000) > start))
        slots.push({ startsAt: start, endsAt: end });
    }
    return slots;
  });
export const inspectIncomingEmail = createServerFn({ method: "GET" })
  .validator(z.object({ emailId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const email = await ownedEntity(db, userId, "emails", data.emailId);
    const [properties, events, contacts, triage] = await Promise.all([
      db.select().from(t.properties).where(eq(t.properties.userId, userId)),
      db.select().from(t.repairRequests).where(eq(t.repairRequests.userId, userId)),
      db.select().from(t.workspaceContacts).where(eq(t.workspaceContacts.userId, userId)),
      db
        .select()
        .from(t.emailTriage)
        .where(and(eq(t.emailTriage.userId, userId), eq(t.emailTriage.emailId, data.emailId))),
    ]);
    const text = String(email["subject"]) + "\n" + String(email["body"]);
    const extracted = extractPropertyAddress(text);
    const candidates = properties
      .filter((p) => !p.archivedAt)
      .map((p) => ({
        id: p.id,
        address: p.address,
        reason: normalizeAddress(text).includes(normalizeAddress(p.address))
          ? "Address appears in this email"
          : [p.tenantEmail, p.ownerEmail, p.managerEmail].some(
                (e) => e && e.toLowerCase() === String(email["fromEmail"]).toLowerCase(),
              )
            ? "Sender matches a property contact"
            : "",
      }))
      .filter((p) => p.reason);
    return {
      email: {
        id: String(email["id"]),
        subject: String(email["subject"]),
        fromEmail: String(email["fromEmail"]),
        fromName: String(email["fromName"]),
        body: String(email["body"]),
        requestId: email["requestId"] ? String(email["requestId"]) : null,
      },
      state: triage[0]?.state ?? "unreviewed",
      extracted,
      candidates,
      contacts: contacts.filter(
        (c) => c.email.toLowerCase() === String(email["fromEmail"]).toLowerCase(),
      ),
      events: events
        .filter((e) => e.boardColumn !== "Completed")
        .map((e) => ({ id: e.id, title: e.title, propertyId: e.propertyId, address: e.address })),
      properties: properties
        .filter((p) => !p.archivedAt)
        .map((p) => ({ id: p.id, address: p.address })),
    };
  });
export const classifyEmail = createServerFn({ method: "POST" })
  .validator(
    z.object({
      emailId: z.string().min(1),
      state: z.enum(["unreviewed", "not_repair", "reviewed"]),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    await ownedEntity(db, userId, "emails", data.emailId);
    await db
      .insert(t.emailTriage)
      .values({ userId, emailId: data.emailId, state: data.state, at: Date.now() })
      .onConflictDoUpdate({
        target: [t.emailTriage.userId, t.emailTriage.emailId],
        set: { state: data.state, at: Date.now() },
      });
    return { ok: true };
  });
export const getReviewQueue = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = await deps();
  const [steps, plans, sessions, actions, events, triage, emails] = await Promise.all([
    db.select().from(t.assistantSteps).where(eq(t.assistantSteps.userId, userId)),
    db.select().from(t.assistantPlans).where(eq(t.assistantPlans.userId, userId)),
    db.select().from(t.assistantSessions).where(eq(t.assistantSessions.userId, userId)),
    db.select().from(t.requestActions).where(eq(t.requestActions.userId, userId)),
    db.select().from(t.repairRequests).where(eq(t.repairRequests.userId, userId)),
    db.select().from(t.emailTriage).where(eq(t.emailTriage.userId, userId)),
    db
      .select({
        id: t.emailMessages.id,
        subject: t.emailMessages.subject,
        requestId: t.emailMessages.requestId,
      })
      .from(t.emailMessages)
      .where(
        and(
          eq(t.emailMessages.userId, userId),
          eq(t.emailMessages.sent, false),
          eq(t.emailMessages.trashed, false),
        ),
      ),
  ]);
  const entries: Array<{
    id: string;
    title: string;
    detail: string;
    kind: string;
    href: string;
    sessionId?: string;
  }> = [];
  for (const s of steps) {
    const p = plans.find((p) => p.id === s.planId);
    if (!p || p.state === "superseded") continue;
    const session = sessions.find((x) => x.id === p.sessionId);
    if (["pending", "failed", "uncertain", "running"].includes(s.state))
      entries.push({
        id: s.id,
        title: assistantActions[s.action]?.label ?? p.title,
        detail: s.error ?? p.title,
        kind:
          s.state === "uncertain"
            ? "Check outcome"
            : s.state === "failed" || Boolean(s.error)
              ? "Needs information"
              : s.state === "running"
                ? "In progress"
                : "Review change",
        href: "/workspace/review",
        sessionId: p.sessionId,
      });
    // Standalone email drafts have no event task, so keep them visible here until a send plan exists.
    if (s.action === "email.draft" && s.state === "succeeded" && s.result) {
      const r = JSON.parse(s.result);
      if (
        !r.actionId &&
        !steps.some(
          (other) => other.action === "email.send" && other.args === JSON.stringify(r.draft),
        )
      )
        entries.push({
          id: s.id,
          title: "Saved email draft",
          detail: session?.title ?? p.title,
          kind: "Draft",
          href: "/workspace/review",
          sessionId: p.sessionId,
        });
    }
  }
  const represented = new Set(
    steps
      .filter(
        (s) =>
          ["pending", "running", "failed", "uncertain"].includes(s.state) &&
          plans.find((p) => p.id === s.planId)?.state !== "superseded",
      )
      .map((s) => JSON.parse(s.args).id),
  );
  for (const a of actions) {
    const e = events.find((e) => e.id === a.requestId);
    if (
      !e ||
      e.boardColumn === "Completed" ||
      !a.active ||
      ["done", "skipped"].includes(a.disposition)
    )
      continue;
    if ((a.state === "pending" || a.state === "sending") && !represented.has(a.id))
      entries.push({
        id: a.id,
        title: a.title,
        detail: `${e.id} · ${e.address}`,
        kind: a.state === "sending" ? "Check outcome" : "Draft",
        href: `/requests/${a.requestId}`,
      });
    else if (a.followUpAt && a.followUpAt <= Date.now())
      entries.push({
        id: "due:" + a.id,
        title: a.title,
        detail: e.address,
        kind: "Follow-up due",
        href: `/requests/${a.requestId}`,
      });
  }
  for (const m of emails) {
    if (triage.some((r) => r.emailId === m.id && r.state !== "unreviewed")) continue;
    entries.push({
      id: "mail:" + m.id,
      title: m.subject,
      detail: m.requestId ?? "Choose a property and event",
      kind: m.requestId ? "Review reply" : "New email",
      href: `/inbox?email=${encodeURIComponent(m.id)}`,
    });
  }
  return entries;
});
