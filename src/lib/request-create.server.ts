import { sql } from "drizzle-orm";
import { repairRequests, requestCounters, requestEvents } from "@/db/schema";
import type { getDb } from "./db.server";
import type { Priority, RepairRequest } from "./data";

export async function createRequestRecord(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  input: { title: string; address: string; priority: Priority },
): Promise<RepairRequest> {
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
    ...input,
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
