import { and, eq, desc, getTableColumns } from "drizzle-orm";
import * as tables from "@/db/schema";
import type { AppDatabase } from "./db.server";
import { assistantActions, type AssistantResult } from "./assistant-actions";
import * as workspace from "./workspace.functions";
import * as requests from "./requests.functions";
import * as incidents from "./incidents.functions";
import * as workflow from "./case-workflow.functions";
import * as management from "./workflow-management.functions";
import * as contacts from "./contacts.functions";
import * as mail from "./gmail.functions";
import * as actions from "./incident-actions.functions";
import { actionContext, listActionPlan } from "./incident-actions.server";
import { confirmAssistantProperty } from "./assistant-property.functions";

const entities = {
  properties: tables.properties,
  contacts: tables.workspaceContacts,
  events: tables.repairRequests,
  appointments: tables.appointments,
  emails: tables.emailMessages,
  quotes: tables.requestQuotes,
  files: tables.caseAttachments,
  actions: tables.requestActions,
};
export async function entityRows(
  db: AppDatabase,
  userId: string,
  entity: string,
): Promise<Record<string, unknown>[]> {
  if (!(entity in entities)) throw new Error("Unknown record type");
  const table = entities[entity as keyof typeof entities];
  if (entity === "files") {
    const { content: _content, ...cols } = getTableColumns(tables.caseAttachments);
    return db
      .select(cols)
      .from(tables.caseAttachments)
      .where(eq(tables.caseAttachments.userId, userId));
  }
  if (entity === "emails") {
    const { body: _body, ...cols } = getTableColumns(tables.emailMessages);
    return db
      .select(cols)
      .from(tables.emailMessages)
      .where(eq(tables.emailMessages.userId, userId))
      .orderBy(desc(tables.emailMessages.receivedAt))
      .limit(500);
  }
  return db.select().from(table).where(eq(table.userId, userId));
}
export async function ownedEntity(db: AppDatabase, userId: string, entity: string, id: unknown) {
  const table = entities[entity as keyof typeof entities];
  if (!table) throw new Error("Unsupported record");
  // Query the primary key directly, including older mail beyond search pagination.
  const rows = await db
    .select()
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.id, id as never)))
    .limit(1);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`${entity} record not found`);
  const { content: _content, ...safe } = row;
  return safe;
}
export async function actionSnapshot(
  db: AppDatabase,
  userId: string,
  action: string,
  args: Record<string, unknown>,
) {
  const refs = assistantActions[action]!.fields.filter(
    (f) =>
      f.entity &&
      f.type !== "ids" &&
      args[f.key] !== undefined &&
      args[f.key] !== null &&
      args[f.key] !== "" &&
      !String(args[f.key]).startsWith("$"),
  );
  const rows: Record<string, unknown>[] = [];
  for (const field of refs) {
    const row = await ownedEntity(db, userId, field.entity!, args[field.key]);
    rows.push({ entity: field.entity, ...row });
    if (row["requestId"] && field.entity !== "events")
      rows.push(await ownedEntity(db, userId, "events", row["requestId"]));
  }
  if (args["threadId"]) {
    const emails = await db
      .select()
      .from(tables.emailMessages)
      .where(
        and(
          eq(tables.emailMessages.userId, userId),
          eq(tables.emailMessages.threadId, String(args["threadId"])),
        ),
      )
      .limit(1);
    if (!emails.length) throw new Error("Email thread not found");
    if (args["requestId"] && emails[0]!.requestId !== args["requestId"])
      throw new Error("Email thread belongs to a different event");
  }
  if (Array.isArray(args["attachmentIds"]))
    for (const fileId of args["attachmentIds"]) {
      if (typeof fileId === "string" && fileId.startsWith("$")) continue;
      const file = await ownedEntity(db, userId, "files", fileId);
      if (file["requestId"] !== args["requestId"] && args["requestId"])
        throw new Error("Attachment belongs to another event");
      rows.push(file);
    }
  if (
    action === "event.correct_property" &&
    !Object.values(args).some((v) => typeof v === "string" && v.startsWith("$"))
  )
    rows.push(
      await management.previewPropertyCorrection({
        data: { requestId: String(args["requestId"]), propertyId: Number(args["propertyId"]) },
      }),
    );
  if (action === "property.sync_contacts") {
    const changes = await workspace.listPropertyContactChanges();
    rows.push({ changes: changes.find((c) => c.requestId === args["requestId"]) ?? null });
  }
  // Participants are part of review context for delivery, quotes, appointment notices and closure.
  const requestIds = new Set(
    rows.map((r) => r["requestId"] ?? (r["entity"] === "events" ? r["id"] : null)).filter(Boolean),
  );
  for (const requestId of requestIds) {
    rows.push({
      participants: await db
        .select()
        .from(tables.requestParticipants)
        .where(
          and(
            eq(tables.requestParticipants.userId, userId),
            eq(tables.requestParticipants.requestId, String(requestId)),
          ),
        ),
    });
  }
  if (action === "action.send" || action === "action.edit") {
    const row = rows.find((r) => r["entity"] === "actions");
    if (row)
      rows.push({
        sourceVersion: (await actionContext(db, userId, String(row["requestId"]))).version,
      });
  }
  const encoded = new TextEncoder().encode(JSON.stringify(rows));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, "0")).join("");
}
export function recordHref(entity: string, row: Record<string, unknown>) {
  if (entity === "events") return `/requests/${row["id"]}`;
  if (entity === "properties") return `/workspace/properties?property=${row["id"]}`;
  if (entity === "emails") return "/inbox";
  if (row["requestId"]) return `/requests/${row["requestId"]}`;
  return `/workspace/${entity === "appointments" ? "calendar" : entity === "contacts" ? "contacts" : "properties"}`;
}
export async function searchWorkspace(
  db: AppDatabase,
  userId: string,
  args: Record<string, unknown>,
): Promise<AssistantResult> {
  const entity = String(args["entity"]);
  if (args["recordId"] && entity in entities) {
    const row = await ownedEntity(db, userId, entity, args["recordId"]);
    if (entity === "events") {
      const detail = await incidents.getIncident({ data: { id: String(args["recordId"]) } });
      return {
        summary: "Selected event details",
        rows: [
          {
            ...row,
            details: {
              ...detail,
              unlinkedEmails: [],
              emails: detail.emails.slice(-20).map((e) => ({ ...e, body: e.body.slice(0, 10000) })),
              events: detail.events.slice(-30),
            },
            href: recordHref(entity, row),
          },
        ],
      };
    }
    if (typeof row["body"] === "string") row["body"] = row["body"].slice(0, 20000);
    return {
      summary: "Selected record details",
      rows: [{ ...row, href: recordHref(entity, row) }],
    };
  }
  if (entity === "analytics")
    return { summary: "Current workspace analytics", rows: [await workspace.getAnalytics()] };
  let rows: Record<string, unknown>[] =
    entity === "notifications"
      ? await management.listNotifications()
      : await entityRows(db, userId, entity);
  if (entity === "contacts") {
    const known = new Set(rows.map((r) => r["email"]));
    rows.push(
      ...(await workspace.listContacts())
        .filter((c) => !known.has(c.email))
        .map((c) => ({
          ...c,
          source: "Property/event contact; create directory profile to associate elsewhere",
        })),
    );
  }
  if (entity === "actions" && args["requestId"]) {
    const plan = await listActionPlan(db, userId, String(args["requestId"]));
    rows = plan.actions as unknown as Record<string, unknown>[];
  }
  const query = String(args["query"] ?? "").toLowerCase();
  rows = rows.filter(
    (r) =>
      (!query || JSON.stringify(r).toLowerCase().includes(query)) &&
      (!args["propertyId"] ||
        r["propertyId"] === args["propertyId"] ||
        (entity === "properties" && r["id"] === args["propertyId"])) &&
      (!args["requestId"] ||
        r["requestId"] === args["requestId"] ||
        (entity === "events" && r["id"] === args["requestId"])) &&
      (!args["from"] ||
        Number(r["startsAt"] ?? r["receivedAt"] ?? r["createdAt"] ?? r["at"]) >=
          Number(args["from"])) &&
      (!args["until"] ||
        Number(r["startsAt"] ?? r["receivedAt"] ?? r["createdAt"] ?? r["at"]) <
          Number(args["until"])),
  );
  return {
    summary: `${rows.length} matching ${entity}${rows.length > 40 ? " (showing first 40)" : ""}`,
    rows: rows.slice(0, 40).map((r) => ({ ...r, href: recordHref(entity, r) })),
  };
}
async function call<T, R>(
  fn: (arg: { data: T }) => Promise<R>,
  data: Record<string, unknown>,
): Promise<R> {
  const result = await fn({ data: data as T });
  if (result && typeof result === "object" && "ok" in result && result.ok === false)
    throw new Error(
      "message" in result
        ? String(result.message)
        : `Operation failed: ${"code" in result ? result.code : "unknown"}`,
    );
  return result;
}
export async function executeBusinessAction(
  db: AppDatabase,
  userId: string,
  action: string,
  a: Record<string, unknown>,
  stepId: string,
): Promise<AssistantResult> {
  const requestId = typeof a["requestId"] === "string" ? a["requestId"] : undefined;
  let result: unknown;
  let href = requestId ? `/requests/${requestId}` : undefined;
  if (
    requestId &&
    ![
      "event.update",
      "file.update",
      "file.download",
      "workspace.search",
      "workspace.open",
    ].includes(action)
  )
    await workflow.requireActiveEvent(db, userId, requestId);
  switch (action) {
    case "workspace.search":
      return searchWorkspace(db, userId, a);
    case "workspace.open":
      return {
        summary: "Open selected page",
        href:
          a["page"] === "home"
            ? "/"
            : a["page"] === "event"
              ? `/requests/${a["requestId"]}`
              : a["page"] === "inbox"
                ? "/inbox"
                : `/workspace/${a["page"]}${a["propertyId"] ? `?property=${a["propertyId"]}` : ""}`,
      };
    case "contact.save": {
      const r = await call(contacts.saveDirectoryContact, a);
      return {
        summary: r.created ? "Contact created" : "Contact saved / existing contact reused",
        id: r.contact.id,
        name: r.contact.name,
        email: r.contact.email,
        href: "/workspace/contacts",
      };
    }
    case "contact.archive":
      result = await call(contacts.archiveDirectoryContact, a);
      href = "/workspace/contacts";
      break;
    case "contact.associate":
      result = await call(contacts.associateContact, a);
      href = href ?? `/workspace/properties?property=${a["propertyId"]}`;
      break;
    case "property.create": {
      const r = await call(confirmAssistantProperty, {
        fields: a,
        sourceEmailId: null,
        requestId: null,
      });
      return {
        summary: r.created ? "Property created" : "Existing property reused",
        id: r.property.id,
        propertyId: r.property.id,
        href: `/workspace/properties?property=${r.property.id}`,
      };
    }
    case "property.update":
      result = await call(workspace.updateProperty, a);
      href = `/workspace/properties?property=${a["id"]}`;
      break;
    case "property.archive":
      result = await call(management.archiveProperty, a);
      href = `/workspace/properties?property=${a["id"]}`;
      break;
    case "property.sync_contacts": {
      const changes = await workspace.listPropertyContactChanges();
      const c = changes.find((c) => c.requestId === requestId);
      if (!c) throw new Error("Contacts already match. No changes required.");
      result = await workspace.syncPropertyEventContacts({
        data: { requestId: c.requestId, version: c.version },
      });
      break;
    }
    case "event.create": {
      const r = await call(requests.createRequest, a);
      return { summary: "Event created", id: r.id, requestId: r.id, href: `/requests/${r.id}` };
    }
    case "event.update": {
      const { id, ...patch } = a;
      result = await call(requests.patchRequest, { id, patch });
      href = `/requests/${id}`;
      break;
    }
    case "event.link":
      result = await call(requests.linkProperty, a);
      break;
    case "event.correct_property": {
      const p = await call(management.previewPropertyCorrection, a);
      result = await call(management.correctProperty, {
        ...a,
        version: p.version,
        targetVersion: JSON.stringify(p.target),
      });
      break;
    }
    case "event.person":
      result = await call(incidents.addParticipant, a);
      break;
    case "event.remove_person":
      result = await call(incidents.removeParticipant, a);
      break;
    case "event.note":
      result = await call(incidents.addNote, a);
      break;
    case "event.link_email":
      result = await call(incidents.linkEmail, a);
      break;
    case "event.analyze":
      result = await call(incidents.analyzeIncident, { id: requestId });
      break;
    case "event.close":
      result = await call(workflow.closeCase, a);
      break;
    case "appointment.create": {
      const r = await call(workspace.addAppointment, { ...a, operationId: stepId });
      return {
        summary: "Appointment booked. No invitations sent.",
        id: r.id,
        href: "/workspace/calendar",
      };
    }
    case "appointment.update": {
      const row = await ownedEntity(db, userId, "appointments", a["id"]);
      result = await call(workflow.rescheduleVisit, { ...a, previousStart: row["startsAt"] });
      href = "/workspace/calendar";
      break;
    }
    case "appointment.cancel":
      result = await call(management.cancelVisit, a);
      href = "/workspace/calendar";
      break;
    case "email.draft":
      if (requestId) {
        result = await call(workflow.createContactDraft, {
          ...a,
          email: a["to"],
          operationId: stepId,
        });
        const [saved] = await db
          .select()
          .from(tables.requestActions)
          .where(
            and(
              eq(tables.requestActions.userId, userId),
              eq(tables.requestActions.requestId, requestId),
              eq(tables.requestActions.actionKey, `manual:${stepId}`),
            ),
          );
        return {
          summary: "Draft saved in the event. Nothing sent.",
          id: saved!.id,
          actionId: saved!.id,
          href: href!,
          draft: a,
        };
      }
      return {
        summary: requestId
          ? "Draft saved in this chat and event. Nothing sent."
          : "Draft saved in this chat. Nothing sent.",
        href: href ?? "/inbox",
        draft: a,
      };
    case "email.send":
      result = await call(mail.sendEmail, { ...a, operationId: stepId });
      href = href ?? "/inbox";
      break;
    case "email.move":
      result = await call(mail.moveEmail, a);
      href = "/inbox";
      break;
    case "email.sync": {
      const r = await mail.syncGmail();
      if (!r.ok) throw new Error("Reconnect Gmail before syncing.");
      return { summary: `Synced ${r.count} emails`, href: "/inbox" };
    }
    case "quote.create":
      result = await call(workspace.addQuote, a);
      break;
    case "quote.revise":
      result = await call(management.reviseQuote, a);
      break;
    case "quote.decide":
      result = await call(workflow.recordQuoteDecision, a);
      break;
    case "file.upload": {
      const file = a["file"] as { name: string; mime: string; content: string };
      result = await call(workflow.uploadCaseFile, { ...a, ...file, id: stepId });
      return {
        summary: "File added to case",
        id: stepId,
        fileId: stepId,
        ...(href ? { href } : {}),
      };
    }
    case "file.update":
      result = await call(management.updateCaseFile, a);
      break;
    case "file.download":
      return { summary: "File ready to download", fileId: String(a["id"]) };
    case "action.manage":
      result = await call(workflow.manageAction, a);
      break;
    case "action.edit":
    case "action.send": {
      const row = await ownedEntity(db, userId, "actions", a["id"]);
      if (row["recipientEmail"] !== a["to"])
        throw new Error("Recipient changed. Review the event action again.");
      const input = {
        reviewedVersion: (await actionContext(db, userId, String(row["requestId"]))).version,
        id: a["id"],
        draft: { subject: a["subject"], body: a["body"], attachmentIds: a["attachmentIds"] },
      };
      if (action === "action.send" && row["state"] === "pending")
        await call(actions.saveIncidentAction, input);
      result =
        action === "action.send"
          ? await call(actions.sendIncidentAction, input)
          : await call(actions.saveIncidentAction, input);
      href = `/requests/${row["requestId"]}`;
      break;
    }
    case "notification.read":
      result = await call(management.markNotificationsRead, a);
      break;
    default:
      throw new Error("Unsupported operation");
  }
  if (!href && a["id"]) {
    const target = assistantActions[action]!.fields.find((f) => f.key === "id" && f.entity);
    if (target) {
      const record = await ownedEntity(db, userId, target.entity!, a["id"]);
      href = recordHref(target.entity!, record);
    }
  }
  const row = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return {
    summary: ["email.send", "action.send"].includes(action)
      ? "Email sent"
      : `${assistantActions[action]!.label} completed${typeof row["drafts"] === "number" ? `. ${row["drafts"]} notification drafts prepared; nothing sent.` : ""}`,
    ...(href ? { href } : {}),
    ...(typeof row["id"] === "string" || typeof row["id"] === "number" ? { id: row["id"] } : {}),
  };
}

export async function reviewBusinessImpact(
  db: AppDatabase,
  userId: string,
  action: string,
  args: Record<string, unknown>,
): Promise<AssistantResult | null> {
  if (Object.values(args).some((v) => typeof v === "string" && v.startsWith("$"))) return null;
  if (action === "event.correct_property") {
    const p = await management.previewPropertyCorrection({
      data: { requestId: String(args["requestId"]), propertyId: Number(args["propertyId"]) },
    });
    return {
      summary: "Review property correction before confirming",
      rows: [
        {
          from: p.from,
          to: p.target.address,
          appointmentsUpdated: p.appointments,
          quotesSuperseded: p.quotes,
          draftsWithdrawn: p.drafts,
          filesRetained: p.files,
        },
        ...p.newPeople.map((c) => ({ role: c.role, name: c.name, email: c.email })),
      ],
    };
  }
  if (action === "property.sync_contacts") {
    const change = (await workspace.listPropertyContactChanges()).find(
      (c) => c.requestId === args["requestId"],
    );
    return {
      summary: change ? "Review replacement contacts" : "Contacts already match",
      rows: change
        ? [
            ...change.current.map((c) => ({ change: "Before", ...c })),
            ...change.next.map((c) => ({ change: "After", ...c })),
          ]
        : [],
    };
  }
  if (action === "contact.associate" && args["propertyId"]) {
    const p = await ownedEntity(db, userId, "properties", args["propertyId"]);
    const prefix =
      args["role"] === "Landlord" ? "owner" : args["role"] === "Tenant" ? "tenant" : "manager";
    return {
      summary: "The selected property role will use this contact",
      rows: [
        {
          property: p["address"],
          role: args["role"],
          previousName: p[`${prefix}Name`],
          previousEmail: p[`${prefix}Email`],
        },
      ],
    };
  }
  return null;
}
