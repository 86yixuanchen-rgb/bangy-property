import { createServerFn } from "@tanstack/react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { repairRequests, requestEvents } from "@/db/schema";
import { type RepairRequest } from "@/lib/data";

const priority = z.enum(["Urgent", "High", "Medium", "Low"]);
const column = z.enum(["New", "Waiting", "Action Needed", "Scheduled", "Completed"]);

const requestInput = z.object({
  id: z.string().regex(/^REQ-\d+$/),
  title: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  priority,
  column,
  status: z.string().max(200),
  waitingOn: z.string().max(200),
  nextAction: z.string().max(300),
  waiting: z.string().max(100),
  lastUpdate: z.string().max(100),
});

const requestPatch = requestInput.omit({ id: true, address: true }).partial();

async function requireUserId() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

type Row = typeof repairRequests.$inferSelect;

function toRequest(row: Row): RepairRequest {
  return {
    id: row.id,
    propertyId: row.propertyId,
    title: row.title,
    address: row.address,
    priority: row.priority,
    column: row.boardColumn,
    status: row.status,
    waitingOn: row.waitingOn,
    nextAction: row.nextAction,
    waiting: row.waiting,
    lastUpdate: row.lastUpdate,
  };
}

export const listRequests = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  const { getDb } = await import("./db.server");
  const db = await getDb();

  const existing = await db
    .select()
    .from(repairRequests)
    .where(eq(repairRequests.userId, userId))
    .orderBy(asc(repairRequests.sortOrder));
  return existing.map(toRequest);
});

export const createRequest = createServerFn({ method: "POST" })
  .validator(
    requestInput
      .pick({ title: true, priority: true })
      .extend({ propertyId: z.number().int().positive() }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const { getDb } = await import("./db.server");
    const db = await getDb();
    const { createRequestRecord } = await import("./request-create.server");
    return createRequestRecord(db, userId, data);
  });

export const patchRequest = createServerFn({ method: "POST" })
  .validator(z.object({ id: requestInput.shape.id, patch: requestPatch }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const { getDb } = await import("./db.server");
    const db = await getDb();
    const { column: boardColumn, ...rest } = data.patch;
    const set = { ...rest, ...(boardColumn ? { boardColumn } : {}) };
    if (Object.keys(set).length > 0) {
      const [before] = boardColumn
        ? await db
            .select({ column: repairRequests.boardColumn })
            .from(repairRequests)
            .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, data.id)))
        : [];
      await db
        .update(repairRequests)
        .set(set)
        .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, data.id)));
      if (boardColumn && before && before.column !== boardColumn) {
        await db.insert(requestEvents).values({
          userId,
          requestId: data.id,
          at: Date.now(),
          kind: "status",
          text: `Status changed from ${before.column} to ${boardColumn}`,
          actor: "Property Manager",
        });
      }
    }
    return { ok: true as const };
  });

export const linkProperty = createServerFn({ method: "POST" })
  .validator(
    z.object({ requestId: requestInput.shape.id, propertyId: z.number().int().positive() }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const { getDb } = await import("./db.server");
    const { linkRequestToProperty } = await import("./request-create.server");
    await linkRequestToProperty(await getDb(), userId, data.requestId, data.propertyId);
    return { ok: true as const };
  });
