import { and, eq, sql } from "drizzle-orm";
import * as t from "@/db/schema";
import type { AppDatabase } from "./db.server";
import { ownedEntity } from "./assistant-executor.server";
const contactKeys = ["name", "email", "role", "phone", "notes"];
export async function captureUndo(
  db: AppDatabase,
  userId: string,
  action: string,
  args: Record<string, unknown>,
) {
  const entity =
    action === "contact.save" && args["id"]
      ? "contacts"
      : action === "property.update"
        ? "properties"
        : null;
  if (!entity) return null;
  const row = await ownedEntity(db, userId, entity, args["id"]);
  const keys = entity === "contacts" ? contactKeys : ["notes"];
  if (
    entity === "properties" &&
    Object.keys(args).some((k) => k !== "id" && k !== "notes" && args[k] !== row[k])
  )
    return null;
  return {
    entity,
    recordId: String(args["id"]),
    before: Object.fromEntries(keys.map((k) => [k, row[k]])),
  };
}
export async function saveUndo(
  db: AppDatabase,
  userId: string,
  stepId: string,
  before: NonNullable<Awaited<ReturnType<typeof captureUndo>>>,
) {
  const row = await ownedEntity(db, userId, before.entity, before.recordId);
  const after = Object.fromEntries(Object.keys(before.before).map((k) => [k, row[k]]));
  await db
    .insert(t.assistantReceipts)
    .values({
      stepId,
      userId,
      entity: before.entity,
      recordId: before.recordId,
      beforeJson: JSON.stringify(before.before),
      afterJson: JSON.stringify(after),
    })
    .onConflictDoNothing();
}
export async function undoReceipt(db: AppDatabase, userId: string, stepId: string) {
  const [r] = await db
    .select()
    .from(t.assistantReceipts)
    .where(and(eq(t.assistantReceipts.userId, userId), eq(t.assistantReceipts.stepId, stepId)));
  if (!r || r.undoneAt || !r.beforeJson) throw Error("This change cannot be undone.");
  const before = JSON.parse(r.beforeJson) as Record<string, string>,
    after = JSON.parse(r.afterJson) as Record<string, string>;
  const table =
    r.entity === "contacts"
      ? t.workspaceContacts
      : r.entity === "notes"
        ? t.requestEvents
        : t.properties;
  const keys = r.entity === "contacts" ? contactKeys : r.entity === "notes" ? ["text"] : ["notes"];
  const conditions = keys.map((k) => sql`${sql.identifier(k)} = ${after[k]}`);
  // Atomic comparison prevents overwriting any later edits, including a concurrent undo.
  const rows = await db
    .update(table)
    .set(before)
    .where(
      and(
        eq(table.userId, userId),
        eq(table.id, r.recordId as never),
        ...conditions,
        ...(r.entity === "notes" ? [] : [sql`${sql.identifier("archived_at")} IS NULL`]),
      ),
    )
    .returning();
  if (!rows.length)
    throw Error(
      "This record changed after the action. Review it before editing; undo did not overwrite it.",
    );
  await db
    .update(t.assistantReceipts)
    .set({ undoneAt: Date.now() })
    .where(and(eq(t.assistantReceipts.userId, userId), eq(t.assistantReceipts.stepId, stepId)));
  return { ok: true };
}
