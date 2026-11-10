import { getDb } from "./db.server";
import { auth } from "@clerk/tanstack-react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { propertyFields, normalizeAddress } from "./assistant-property";
export const confirmAssistantProperty = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fields: propertyFields,
      sourceEmailId: z.string().max(300).nullable(),
      requestId: z
        .string()
        .regex(/^REQ-\d+$/)
        .nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const [{ and, eq, sql }, { properties }, { loadAssistantSelection }] = await Promise.all([
      import("drizzle-orm"),
      import("@/db/schema"),
      import("./assistant-property.server"),
    ]);
    const { userId } = await auth();
    if (!userId) throw new Error("Please sign in before creating a property.");
    const db = await getDb();
    await loadAssistantSelection(db, userId, {
      ...(data.sourceEmailId ? { emailId: data.sourceEmailId } : {}),
      ...(data.requestId ? { requestId: data.requestId } : {}),
    });
    const fields = { ...data.fields, address: data.fields.address.replace(/\s+/g, " ").trim() };
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
  });
