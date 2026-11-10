import { getDb } from "./db.server";
import { auth } from "@clerk/tanstack-react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { propertyFields } from "./assistant-property";
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
    const { createAssistantProperty, loadAssistantSelection } = await import(
      "./assistant-property.server"
    );
    const { userId } = await auth();
    if (!userId) throw new Error("Please sign in before creating a property.");
    const db = await getDb();
    await loadAssistantSelection(db, userId, {
      ...(data.sourceEmailId ? { emailId: data.sourceEmailId } : {}),
      ...(data.requestId ? { requestId: data.requestId } : {}),
    });
    return createAssistantProperty(db, userId, data.fields);
  });
