import { and, eq, sql } from "drizzle-orm";
import {
  properties,
  repairRequests,
  requestCounters,
  requestEvents,
  requestParticipants,
} from "@/db/schema";
import type { getDb } from "./db.server";
import type { Priority, RepairRequest } from "./data";

export async function createRequestRecord(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  input: { title: string; propertyId: number; priority: Priority },
): Promise<RepairRequest> {
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.userId, userId), eq(properties.id, input.propertyId)));
  if (!property || property.archivedAt) throw new Error("Property not found in your workspace");
  const inherited = propertyPeople(property);
  const next = sql`(SELECT coalesce(max(cast(substr(id, 5) as integer)), 108) + 1
    FROM repair_requests WHERE user_id = ${userId})`;
  const [counter] = await db
    .insert(requestCounters)
    .values({ userId, value: next })
    .onConflictDoUpdate({
      target: requestCounters.userId,
      set: { value: sql`max(${requestCounters.value} + 1, ${next})` },
    })
    .returning();
  if (!counter) throw new Error("Could not reserve a request number");
  const request: RepairRequest = {
    title: input.title,
    priority: input.priority,
    address: property.address,
    propertyId: property.id,
    id: `REQ-${counter.value}`,
    column: "New",
    status: "Awaiting triage",
    waitingOn: "Property Manager",
    nextAction: "Review request & assign trade",
    waiting: "Just now",
    lastUpdate: "Just now",
  };
  const { column, ...fields } = request;
  await db.batch([
    db.insert(repairRequests).values({
      ...fields,
      userId,
      boardColumn: column,
      sortOrder: sql`(SELECT min(0, coalesce(min(sort_order), 0)) - 1 FROM repair_requests WHERE user_id = ${userId})`,
    }),
    ...(inherited.length
      ? [
          db
            .insert(requestParticipants)
            .values(inherited.map((p) => ({ userId, requestId: request.id, ...p }))),
        ]
      : []),
    db.insert(requestEvents).values({
      userId,
      requestId: request.id,
      at: Date.now(),
      kind: "created",
      text: `Request created: ${request.title}`,
      actor: "Property Manager",
    }),
  ]);
  return request;
}

export function propertyPeople(property: typeof properties.$inferSelect) {
  return [
    { role: "Property Manager" as const, name: property.managerName, email: property.managerEmail },
    { role: "Landlord" as const, name: property.ownerName, email: property.ownerEmail },
    { role: "Tenant" as const, name: property.tenantName, email: property.tenantEmail },
  ]
    .filter((p) => p.email.trim())
    .map((p) => ({ ...p, email: p.email.trim().toLowerCase() }))
    .filter((p, i, all) => all.findIndex((q) => q.email === p.email) === i);
}

export async function linkRequestToProperty(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  requestId: string,
  propertyId: number,
) {
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.userId, userId), eq(properties.id, propertyId)));
  const [request] = await db
    .select()
    .from(repairRequests)
    .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, requestId)));
  if (!property || property.archivedAt || !request)
    throw new Error("Active property or request not found");
  if (request.boardColumn === "Completed")
    throw new Error("Reopen the event before linking a property.");
  if (request.propertyId && request.propertyId !== propertyId)
    throw new Error("This request already belongs to another property");
  const people = propertyPeople(property);
  const match = sql`EXISTS (SELECT 1 FROM repair_requests WHERE user_id = ${userId} AND id = ${requestId} AND property_id = ${propertyId})`;
  const [updated] = await db.batch([
    db
      .update(repairRequests)
      .set({ propertyId, address: property.address })
      .where(
        and(
          eq(repairRequests.userId, userId),
          eq(repairRequests.id, requestId),
          sql`(property_id IS NULL OR property_id = ${propertyId})`,
        ),
      )
      .returning({ id: repairRequests.id }),
    ...people.map((p) =>
      db
        .insert(requestParticipants)
        .select(sql`SELECT ${userId},${requestId},${p.role},${p.name},${p.email} WHERE ${match}`)
        .onConflictDoNothing(),
    ),
    db
      .insert(requestEvents)
      .select(
        sql`SELECT NULL,${userId},${requestId},${Date.now()},'note',${`Linked to property: ${property.address}`},'Property Manager' WHERE ${match}`,
      ),
  ]);
  if (!updated.length) throw new Error("This event was already linked to a different property");
}
