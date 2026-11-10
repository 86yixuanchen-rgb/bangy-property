import { and, eq, sql } from "drizzle-orm";
import {
  appointments,
  emailMessages,
  properties,
  repairRequests,
  requestParticipants,
} from "@/db/schema";
import type { AppDatabase } from "./db.server";
import {
  extractPropertyAddress,
  normalizeAddress,
  type AssistantContext,
  type AssistantPropertyDraft,
  type PropertyFields,
} from "./assistant-property";
export async function loadAssistantSelection(
  db: AppDatabase,
  userId: string,
  context?: AssistantContext,
) {
  for (const id of context?.evidenceEmailIds ?? []) {
    const [source] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(eq(emailMessages.userId, userId), eq(emailMessages.id, id)));
    if (!source) throw new Error("Source email not found");
  }
  const email = context?.emailId
    ? (
        await db
          .select()
          .from(emailMessages)
          .where(and(eq(emailMessages.userId, userId), eq(emailMessages.id, context.emailId)))
      )[0]
    : undefined;
  if (context?.emailId && (!email || email.trashed))
    throw new Error("The selected email is unavailable. Select an email again.");
  const appointment = context?.appointmentId
    ? (
        await db
          .select()
          .from(appointments)
          .where(and(eq(appointments.userId, userId), eq(appointments.id, context.appointmentId)))
      )[0]
    : undefined;
  if (context?.appointmentId && !appointment) throw new Error("Appointment not found");
  const requestId = email?.requestId ?? context?.requestId ?? appointment?.requestId;
  const request = requestId
    ? (
        await db
          .select()
          .from(repairRequests)
          .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, requestId)))
      )[0]
    : undefined;
  if (requestId && !request)
    throw new Error("The selected event is unavailable. Select an event again.");
  const people = request
    ? await db
        .select()
        .from(requestParticipants)
        .where(
          and(
            eq(requestParticipants.userId, userId),
            eq(requestParticipants.requestId, request.id),
          ),
        )
    : [];
  const selectedPropertyId = request?.propertyId ?? context?.propertyId ?? appointment?.propertyId;
  const property = selectedPropertyId
    ? (
        await db
          .select()
          .from(properties)
          .where(and(eq(properties.userId, userId), eq(properties.id, selectedPropertyId!)))
      )[0]
    : undefined;
  if (context?.propertyId && !property) throw new Error("Property not found");
  return { email, request, people, property, appointment };
}
export function propertyDraftFromSelection(
  selection: Awaited<ReturnType<typeof loadAssistantSelection>>,
  question: string,
): AssistantPropertyDraft {
  const { email, request, people, property } = selection;
  const fields: PropertyFields = {
    address:
      extractPropertyAddress(question) ||
      extractPropertyAddress(email?.subject ?? "") ||
      extractPropertyAddress(email?.body ?? "") ||
      property?.address ||
      extractPropertyAddress(request?.address ?? ""),
    managerName: "",
    managerEmail: "",
    ownerName: "",
    ownerEmail: "",
    tenantName: "",
    tenantEmail: "",
    notes: "",
  };
  for (const [role, nameKey, emailKey] of [
    ["Property Manager", "managerName", "managerEmail"],
    ["Landlord", "ownerName", "ownerEmail"],
    ["Tenant", "tenantName", "tenantEmail"],
  ] as const) {
    const person = people.find((p) => p.role === role);
    if (
      person &&
      (!property || normalizeAddress(property.address) === normalizeAddress(fields.address))
    ) {
      fields[nameKey] = person.name;
      fields[emailKey] = person.email;
    }
  }
  return {
    fields,
    source: email
      ? `Email: ${email.subject} · ${email.fromName} <${email.fromEmail}>`
      : request
        ? `${request.id} · ${request.title}`
        : "Your message",
    sourceEmailId: email?.id ?? null,
    requestId: request?.id ?? null,
    canLink: !!request && !request.propertyId && request.boardColumn !== "Completed",
  };
}

export async function createAssistantProperty(
  db: AppDatabase,
  userId: string,
  input: PropertyFields,
) {
  const fields = { ...input, address: input.address.replace(/\s+/g, " ").trim() };
  if (!fields.address) throw new Error("Enter the property address before creating it.");
  for (const [name, email] of [
    [fields.managerName, fields.managerEmail],
    [fields.ownerName, fields.ownerEmail],
    [fields.tenantName, fields.tenantEmail],
  ])
    if (Boolean(name) !== Boolean(email))
      throw new Error("Provide both a name and email for each contact, or leave both blank.");
  const key = normalizeAddress(fields.address);
  const existing = (
    await db.select().from(properties).where(eq(properties.userId, userId))
  ).filter((p) => normalizeAddress(p.address) === key);
  if (existing.length > 1)
    throw new Error(
      "Multiple properties match this address. Select the correct one in Properties.",
    );
  if (existing[0]) {
    if (existing[0].archivedAt)
      throw new Error(
        "This property is archived. Restore it in Properties instead of creating a duplicate.",
      );
    return { created: false, property: existing[0] };
  }
  // One atomic insert statement makes simultaneous clicks/retries reuse the same address.
  const inserted = await db
    .insert(properties)
    .select(
      sql`SELECT NULL,NULL,${userId},${fields.address},${fields.managerName},${fields.managerEmail},${fields.tenantName},${fields.tenantEmail},${fields.ownerName},${fields.ownerEmail},${fields.notes} WHERE NOT EXISTS (SELECT 1 FROM properties WHERE user_id=${userId} AND lower(trim(address))=${key})`,
    )
    .returning();
  const property =
    inserted[0] ??
    (
      await db
        .select()
        .from(properties)
        .where(and(eq(properties.userId, userId), sql`lower(trim(${properties.address}))=${key}`))
    )[0];
  if (!property || property.archivedAt)
    throw new Error("Property could not be created. Refresh Properties and check the address.");
  return { created: inserted.length > 0, property };
}
