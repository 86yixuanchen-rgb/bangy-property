import { z } from "zod";
export type Field = {
  key: string;
  label: string;
  type?: "number" | "time" | "text" | "long" | "boolean" | "emails" | "ids" | "file";
  options?: string[];
  entity?: string;
  optional?: boolean;
  default?: unknown;
};
export type ActionDefinition = {
  label: string;
  description: string;
  fields: Field[];
  confirm?: "send" | "individual";
  read?: boolean;
};
const f = (key: string, label: string, extras: Partial<Field> = {}): Field => ({
  key,
  label,
  ...extras,
});
const id = (entity: string, key = "id") =>
  f(
    key,
    (
      {
        properties: "Property",
        events: "Event",
        contacts: "Contact",
        appointments: "Appointment",
        quotes: "Quote",
        emails: "Email",
        files: "File",
        actions: "Event action",
      } as Record<string, string>
    )[entity] ?? entity,
    {
      entity,
      type: ["properties", "appointments", "quotes"].includes(entity) ? "number" : "text",
    },
  );
const req = id("events", "requestId"),
  prop = id("properties", "propertyId");
const reason = f("reason", "Reason", { type: "long" });
const roles = ["Property Manager", "Landlord", "Tenant", "Repair Team"];
const propertyFields = [
  f("address", "Address"),
  ...["manager", "owner", "tenant"].flatMap((r) => [
    f(`${r}Name`, `${r === "owner" ? "Landlord" : r} name`, { optional: true, default: "" }),
    f(`${r}Email`, `${r === "owner" ? "Landlord" : r} email`, { optional: true, default: "" }),
  ]),
  f("notes", "Notes", { type: "long", optional: true, default: "" }),
];
const contactFields = [
  f("name", "Name"),
  f("email", "Email"),
  f("role", "Role", { options: [...roles, "Other"] }),
  f("phone", "Phone", { optional: true, default: "" }),
  f("notes", "Notes", { optional: true, default: "", type: "long" }),
];
const mail = [
  f("to", "Recipient email"),
  f("subject", "Subject"),
  f("body", "Message", { type: "long" }),
  { ...req, optional: true, default: null },
  f("threadId", "Gmail thread", { optional: true }),
  f("attachmentIds", "Case attachments", {
    type: "ids",
    entity: "files",
    optional: true,
    default: [],
  }),
];
const quote = [
  f("supplier", "Supplier"),
  f("amount", "Amount (AUD)", { type: "number" }),
  f("description", "Description", { type: "long", optional: true, default: "" }),
];
export const assistantActions: Record<string, ActionDefinition> = {
  "workspace.search": {
    label: "Search workspace",
    description:
      "Read scoped records; filter by query, propertyId, requestId, time window. Use this to find exact IDs, never invent IDs.",
    read: true,
    fields: [
      f("entity", "Records", {
        options: [
          "properties",
          "contacts",
          "events",
          "appointments",
          "emails",
          "quotes",
          "files",
          "actions",
          "notifications",
          "analytics",
        ],
      }),
      f("query", "Search", { optional: true, default: "" }),
      f("recordId", "Exact record ID", { optional: true }),
      { ...req, optional: true },
      { ...prop, optional: true },
      f("from", "From", { type: "time", optional: true }),
      f("until", "Until", { type: "time", optional: true }),
    ],
  },
  "workspace.open": {
    label: "Open page",
    description: "Open a site section or a known event/property; navigates only when clicked.",
    read: true,
    fields: [
      f("page", "Page", {
        options: [
          "home",
          "inbox",
          "properties",
          "contacts",
          "calendar",
          "analytics",
          "settings",
          "event",
        ],
      }),
      { ...req, optional: true },
      { ...prop, optional: true },
    ],
  },
  "contact.save": {
    label: "Save contact",
    description:
      "Create independent directory contact or edit existing id. Same email reuses active record without overwriting.",
    fields: [{ ...id("contacts"), optional: true }, ...contactFields],
  },
  "contact.archive": {
    label: "Archive / restore contact",
    description: "Preserves historical event and property associations.",
    confirm: "individual",
    fields: [id("contacts"), f("archive", "Archive", { type: "boolean", default: true })],
  },
  "contact.associate": {
    label: "Associate contact",
    description: "Link active directory contact to exactly one property or event.",
    fields: [
      id("contacts"),
      { ...prop, optional: true },
      { ...req, optional: true },
      f("role", "Role", { options: roles }),
    ],
  },
  "property.create": {
    label: "Create property",
    description: "Create or reuse matching address. Unknown contacts remain blank.",
    fields: propertyFields,
  },
  "property.update": {
    label: "Update property",
    description:
      "Update property profile. Historical event participants remain unchanged. Supply full profile.",
    fields: [id("properties"), ...propertyFields],
  },
  "property.archive": {
    label: "Archive / restore property",
    description: "Archive only without active events or upcoming appointments.",
    confirm: "individual",
    fields: [id("properties"), f("archive", "Archive", { type: "boolean", default: true })],
  },
  "property.sync_contacts": {
    label: "Update event contacts",
    description:
      "Review current property contacts and replace event contact snapshot; preserve history.",
    confirm: "individual",
    fields: [req],
  },
  "event.create": {
    label: "Create event",
    description: "Create repair request on an active property, inheriting contacts.",
    fields: [
      prop,
      f("title", "Title"),
      f("priority", "Priority", {
        options: ["Urgent", "High", "Medium", "Low"],
        default: "Medium",
      }),
    ],
  },
  "event.update": {
    label: "Update event",
    description:
      "Change title/priority/status or reopen a completed event. Closing requires event.close.",
    fields: [
      id("events"),
      f("title", "Title", { optional: true }),
      f("priority", "Priority", { optional: true, options: ["Urgent", "High", "Medium", "Low"] }),
      f("column", "Board status", {
        optional: true,
        options: ["New", "Waiting", "Action Needed", "Scheduled"],
      }),
      f("nextAction", "Next action", { optional: true }),
      f("waitingOn", "Waiting on", { optional: true }),
    ],
  },
  "event.link": {
    label: "Link event to property",
    description:
      "For unlinked events only; already-linked property changes require event.correct_property.",
    fields: [req, prop],
  },
  "event.correct_property": {
    label: "Correct event property",
    description:
      "Replace linked property and contacts; withdraw unsent drafts, supersede quotes, update future bookings. Preserves sent mail/history/files.",
    confirm: "individual",
    fields: [req, prop, reason],
  },
  "event.person": {
    label: "Add event participant",
    description: "Add or update an event participant snapshot.",
    fields: [req, f("role", "Role", { options: roles }), f("name", "Name"), f("email", "Email")],
  },
  "event.remove_person": {
    label: "Remove event participant",
    description: "Remove participant from current event, preserving historical mail.",
    confirm: "individual",
    fields: [req, f("email", "Email")],
  },
  "event.note": {
    label: "Add event note",
    description: "Append a real timeline note.",
    fields: [req, f("text", "Note", { type: "long" })],
  },
  "event.link_email": {
    label: "Link email to event",
    description: "Associate owned email with event.",
    fields: [req, f("emailId", "Email", { entity: "emails" })],
  },
  "event.analyze": {
    label: "Generate event actions",
    description: "Generate the existing editable multi-action plan in the event. No email sent.",
    fields: [req],
  },
  "event.close": {
    label: "Close case",
    description: "Record final outcome; never treat an AI prediction as tenant confirmation.",
    confirm: "individual",
    fields: [
      req,
      f("type", "Outcome type", { options: ["repair_completed", "non_repair"] }),
      f("outcome", "Outcome", { type: "long" }),
      f("cost", "Final cost (AUD)", { type: "number", optional: true, default: null }),
      f("tenantConfirmation", "Tenant confirmation", {
        options: ["confirmed", "not_required", "not_confirmed"],
      }),
      f("confirmationNote", "Confirmation evidence", { type: "long" }),
      f("retainFutureVisits", "Retain future visits", { type: "boolean", default: false }),
      f("futureVisitReason", "Reason for retained visits", { optional: true, default: "" }),
    ],
  },
  "appointment.create": {
    label: "Book appointment",
    description:
      "Internal calendar only; check conflicts on same property or attendee. No invitations automatically sent.",
    fields: [
      prop,
      { ...req, optional: true, default: null },
      f("title", "Title"),
      f("startsAt", "Start (Sydney time)", { type: "time" }),
      f("endsAt", "End (Sydney time)", { type: "time" }),
      f("location", "Location", { optional: true, default: "" }),
      f("attendeeEmails", "Attendee emails", { type: "emails", optional: true, default: [] }),
      f("notes", "Notes", { type: "long", optional: true, default: "" }),
    ],
  },
  "appointment.update": {
    label: "Reschedule / edit appointment",
    description:
      "Change appointment; event appointments create notification drafts for tenant and repair team. Drafts require separate send.",
    fields: [
      id("appointments"),
      f("startsAt", "New start (Sydney time)", { type: "time" }),
      f("endsAt", "New end (Sydney time)", { type: "time" }),
      f("title", "Title", { optional: true }),
      f("location", "Location"),
      f("attendeeEmails", "Attendee emails", { type: "emails", optional: true }),
      f("notes", "Notes", { type: "long", optional: true }),
      reason,
    ],
  },
  "appointment.cancel": {
    label: "Cancel appointment",
    description: "Cancel visit and prepare separate notices, without sending.",
    confirm: "individual",
    fields: [id("appointments"), reason],
  },
  "email.draft": {
    label: "Save email draft",
    description:
      "Persist reviewed draft in chat; when event-linked also save in event action list. No mail sent.",
    fields: mail,
  },
  "email.send": {
    label: "Send email",
    description:
      "Send exactly reviewed recipient, subject, body and attachments. Requires separate explicit send confirmation. For event action drafts use action.send.",
    confirm: "send",
    fields: mail,
  },
  "email.move": {
    label: "Trash / restore email",
    description: "Updates Gmail mailbox.",
    confirm: "individual",
    fields: [id("emails"), f("trash", "Move to Trash", { type: "boolean", default: true })],
  },
  "email.sync": {
    label: "Sync inbox",
    description: "Fetch latest mail using connected Gmail account.",
    fields: [],
  },
  "quote.create": {
    label: "Add quote",
    description: "Add actual supplier quote to event.",
    fields: [req, ...quote],
  },
  "quote.revise": {
    label: "Revise quote",
    description: "Create new quote version and retain prior decision history.",
    fields: [id("quotes"), ...quote, reason],
  },
  "quote.decide": {
    label: "Record landlord decision",
    description:
      "Record evidenced landlord approval/rejection. AI cannot approve on behalf of landlord.",
    confirm: "individual",
    fields: [
      id("quotes"),
      f("decision", "Decision", { options: ["Approved", "Rejected"] }),
      f("method", "Evidence method", { options: ["email", "phone"] }),
      f("evidence", "Evidence", { type: "long" }),
      f("emailId", "Evidence email", { entity: "emails", optional: true }),
      f("amount", "Reviewed amount (AUD)", { type: "number" }),
    ],
  },
  "file.upload": {
    label: "Upload case file",
    description:
      "User must select local file; do not invent files or paths. PNG/JPEG/WebP/PDF up to 1 MB.",
    fields: [
      req,
      f("category", "Category", {
        options: ["Damage photo", "Quote", "Completion photo", "Other"],
      }),
      f("file", "Choose file", { type: "file" }),
    ],
  },
  "file.update": {
    label: "Update / recycle case file",
    description: "Rename, classify, associate quote, trash or restore.",
    confirm: "individual",
    fields: [
      id("files"),
      f("name", "Filename"),
      f("category", "Category", {
        options: ["Damage photo", "Quote", "Completion photo", "Other"],
      }),
      f("quoteId", "Quote", { entity: "quotes", type: "number", optional: true, default: null }),
      f("trash", "Move to recycle bin", { type: "boolean", default: false }),
    ],
  },
  "file.download": {
    label: "Download case file",
    description: "Return a download control for an owned file.",
    read: true,
    fields: [id("files")],
  },
  "action.manage": {
    label: "Manage follow-up / task",
    description:
      "Skip, mark done, defer, restore, schedule/clear followup or match reply; reason required for skipped/done tasks.",
    fields: [
      id("actions"),
      f("operation", "Operation", {
        options: ["skip", "done", "defer", "restore", "followup", "clear_followup", "reply_done"],
      }),
      reason,
      f("dueAt", "Due date (Sydney time)", { type: "time", optional: true }),
      f("replyId", "Reply email", { entity: "emails", optional: true }),
    ],
  },
  "action.edit": {
    label: "Edit event email draft",
    description: "Save a pending event action draft.",
    fields: [
      id("actions"),
      f("to", "Recipient"),
      f("subject", "Subject"),
      f("body", "Message", { type: "long" }),
      f("attachmentIds", "Case attachments", {
        type: "ids",
        entity: "files",
        optional: true,
        default: [],
      }),
    ],
  },
  "action.send": {
    label: "Send event action",
    description:
      "Send reviewed event draft through existing dependency checks and duplicate protection.",
    confirm: "send",
    fields: [
      id("actions"),
      f("to", "Recipient"),
      f("subject", "Subject"),
      f("body", "Message", { type: "long" }),
      f("attachmentIds", "Case attachments", {
        type: "ids",
        entity: "files",
        optional: true,
        default: [],
      }),
    ],
  },
  "notification.read": {
    label: "Mark notifications read",
    description: "Mark selected notification keys read.",
    fields: [f("keys", "Notification keys", { type: "ids" })],
  },
};
export const plannedStep = z.object({
  action: z.string().refine((a) => Boolean(assistantActions[a]), "Unsupported action"),
  args: z.record(z.unknown()).default({}),
  dependsOn: z.array(z.number().int().positive()).default([]),
});
export type ProposedStep = z.infer<typeof plannedStep>;
export function reference(value: unknown) {
  return typeof value === "string" ? value.match(/^\$(\d+)\.([A-Za-z][\w]*)$/) : null;
}
export function referencedSteps(value: unknown): number[] {
  const ref = reference(value);
  if (ref) return [Number(ref[1])];
  if (Array.isArray(value)) return value.flatMap(referencedSteps);
  if (value && typeof value === "object") return Object.values(value).flatMap(referencedSteps);
  return [];
}
export function resolveActionReferences(
  value: unknown,
  lookup: (position: number, key: string) => unknown,
): unknown {
  const ref = reference(value);
  if (ref) return lookup(Number(ref[1]), ref[2]!);
  if (Array.isArray(value)) return value.map((v) => resolveActionReferences(v, lookup));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveActionReferences(v, lookup)]),
    );
  return value;
}
export function dependencies(step: ProposedStep) {
  return [...new Set([...step.dependsOn, ...referencedSteps(step.args)])];
}
export function validatePlan(steps: ProposedStep[]) {
  if (!steps.length || steps.length > 12) throw new Error("A plan needs 1–12 actions.");
  steps.forEach((s, i) => {
    if (dependencies(s).some((d) => d > i))
      throw new Error("Actions can depend only on earlier steps.");
    for (const k of Object.keys(s.args))
      if (!assistantActions[s.action]!.fields.some((f) => f.key === k))
        throw new Error(`Unknown field: ${k}`);
  });
  return steps;
}
export function parseActionArgs(action: string, args: Record<string, unknown>) {
  const def = assistantActions[action];
  if (!def) throw new Error("Unknown action");
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    let v = args[field.key];
    if (v === undefined || v === null || v === "") {
      if (field.default !== undefined) {
        out[field.key] = field.default;
        continue;
      }
      if (field.optional) continue;
      throw new Error(`Please provide ${field.label}.`);
    }
    if (reference(v)) throw new Error("Complete the prerequisite first.");
    if (field.type === "time" && typeof v === "string") {
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(v))
        throw new Error("Include a timezone offset for appointment times.");
      v = Date.parse(v);
    }
    if (field.type === "number" || field.type === "time") {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Invalid ${field.label}`);
    } else if (field.type === "boolean") {
      if (typeof v !== "boolean") throw new Error(`Invalid ${field.label}`);
    } else if (field.type === "emails" || field.type === "ids") {
      v = z
        .array(
          field.type === "emails" ? z.string().trim().toLowerCase().email() : z.string().min(1),
        )
        .max(40)
        .parse(v);
    } else if (field.type !== "file") {
      if (field.key === "recordId" && typeof v === "number") v = String(v);
      v = z
        .string()
        .trim()
        .max(field.key === "body" ? 20000 : 4000)
        .parse(v);
    }
    if (["to", "email", "managerEmail", "ownerEmail", "tenantEmail"].includes(field.key) && v)
      v = z.string().trim().toLowerCase().email().parse(v);
    if (field.type === "file")
      v = z
        .object({
          name: z.string().min(1).max(200),
          mime: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
          content: z.string().min(1).max(1400000),
        })
        .strict()
        .parse(v);
    if (field.options && !field.options.includes(String(v)))
      throw new Error(`Choose ${field.label}`);
    out[field.key] = v;
  }
  if (action === "workspace.open" && out["page"] === "event" && !out["requestId"])
    throw new Error("Choose an event to open.");
  return out;
}
export function confirmationCommand(text: string) {
  const s = text.trim();
  if (/^(确认执行|confirm changes)$/i.test(s)) return { kind: "bulk" as const };
  const m = s.match(
    /^(确认发送|确认执行|confirm send|confirm action)\s*(?:第\s*)?(\d+)\s*(?:项)?$/i,
  );
  return m
    ? {
        kind: /发送|send/i.test(m[1]!) ? ("send" as const) : ("individual" as const),
        position: Number(m[2]),
      }
    : null;
}
export type AssistantResult = {
  summary: string;
  href?: string;
  id?: string | number;
  propertyId?: number;
  requestId?: string;
  fileId?: string;
  rows?: Record<string, unknown>[];
  [key: string]: unknown;
};

// Existing IDs need dependencies too: e.g. associate a tenant, then create an event
// that inherits that property's contacts, even when the model omits dependsOn.
export function normalizePlanDependencies(input: ProposedStep[]): ProposedStep[] {
  const writes = (s: ProposedStep): [string, unknown][] => {
    if (s.action === "contact.associate")
      return [
        ["properties", s.args["propertyId"]],
        ["events", s.args["requestId"]],
      ];
    if (["property.update", "property.archive"].includes(s.action))
      return [["properties", s.args["id"]]];
    if (s.action === "event.update") return [["events", s.args["id"]]];
    if (s.action.startsWith("event.") || s.action === "property.sync_contacts")
      return [["events", s.args["requestId"]]];
    return [];
  };
  return input.map((step, i) => ({
    ...step,
    dependsOn: [
      ...new Set([
        ...dependencies(step),
        ...input
          .slice(0, i)
          .flatMap((earlier, j) =>
            writes(earlier).some(
              ([entity, value]) =>
                value !== null &&
                value !== undefined &&
                assistantActions[step.action]!.fields.some(
                  (f) => f.entity === entity && step.args[f.key] === value,
                ),
            )
              ? [j + 1]
              : [],
          ),
      ]),
    ],
  }));
}
