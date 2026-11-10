import { createServerFn } from "@tanstack/react-start";
import { auth } from "@clerk/tanstack-react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db.server";
import { workspaceContacts, properties } from "@/db/schema";
export const contactFields = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["Property Manager", "Landlord", "Tenant", "Repair Team", "Other"]),
  phone: z.string().trim().max(80).default(""),
  notes: z.string().trim().max(1000).default(""),
});
async function deps() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return { db: await getDb(), userId };
}
export const listDirectoryContacts = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = await deps();
  return db.select().from(workspaceContacts).where(eq(workspaceContacts.userId, userId));
});
export const saveDirectoryContact = createServerFn({ method: "POST" })
  .validator(contactFields.extend({ id: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const { id, ...fields } = data;
    if (id) {
      const [before] = await db
        .select()
        .from(workspaceContacts)
        .where(and(eq(workspaceContacts.userId, userId), eq(workspaceContacts.id, id)));
      if (!before) throw new Error("Contact not found");
      if (before.archivedAt) throw new Error("Restore this contact before editing");
      const [saved] = await db
        .update(workspaceContacts)
        .set(fields)
        .where(and(eq(workspaceContacts.userId, userId), eq(workspaceContacts.id, id)))
        .returning();
      return { contact: saved!, created: false };
    }
    const added = await db
      .insert(workspaceContacts)
      .values({ id: crypto.randomUUID(), userId, ...fields, createdAt: Date.now() })
      .onConflictDoNothing()
      .returning();
    const row =
      added[0] ??
      (
        await db
          .select()
          .from(workspaceContacts)
          .where(
            and(eq(workspaceContacts.userId, userId), eq(workspaceContacts.email, fields.email)),
          )
      )[0];
    if (!row || row.archivedAt)
      throw new Error("This contact is archived. Restore it instead of creating a duplicate.");
    return { contact: row, created: added.length > 0 };
  });
export const archiveDirectoryContact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), archive: z.boolean() }))
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const rows = await db
      .update(workspaceContacts)
      .set({ archivedAt: data.archive ? Date.now() : null })
      .where(and(eq(workspaceContacts.userId, userId), eq(workspaceContacts.id, data.id)))
      .returning();
    if (!rows.length) throw new Error("Contact not found");
    return { ok: true };
  });
export const associateContact = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      propertyId: z.number().int().positive().optional(),
      requestId: z
        .string()
        .regex(/^REQ-\d+$/)
        .optional(),
      role: z.enum(["Property Manager", "Landlord", "Tenant", "Repair Team"]),
    }),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await deps();
    const [c] = await db
      .select()
      .from(workspaceContacts)
      .where(and(eq(workspaceContacts.userId, userId), eq(workspaceContacts.id, data.id)));
    if (!c || c.archivedAt) throw new Error("Choose an active contact");
    if (Boolean(data.propertyId) === Boolean(data.requestId))
      throw new Error("Choose either a property or an event");
    if (data.propertyId) {
      if (data.role === "Repair Team") throw new Error("Associate repair teams with an event");
      const [p] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.userId, userId), eq(properties.id, data.propertyId)));
      if (!p || p.archivedAt) throw new Error("Choose an active property");
      const role =
        data.role === "Landlord" ? "owner" : data.role === "Tenant" ? "tenant" : "manager";
      const { updateProperty } = await import("./workspace.functions");
      await updateProperty({ data: { ...p, [`${role}Name`]: c.name, [`${role}Email`]: c.email } });
    } else {
      const { requireActiveEvent } = await import("./case-workflow.functions");
      await requireActiveEvent(db, userId, data.requestId!);
      const { addParticipant } = await import("./incidents.functions");
      await addParticipant({
        data: { requestId: data.requestId!, name: c.name, email: c.email, role: data.role },
      });
    }
    return { ok: true };
  });
