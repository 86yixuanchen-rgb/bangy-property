import { and, eq } from "drizzle-orm";
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
