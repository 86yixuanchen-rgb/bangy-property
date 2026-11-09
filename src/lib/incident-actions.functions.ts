import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { auth } from "@clerk/tanstack-react-start/server";
import { z } from "zod";
import { actionDraft } from "./incident-action-types";
const input = z.object({
  id: z.string().uuid(),
  draft: actionDraft,
  reviewedVersion: z.string().optional(),
});
async function deps() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const { getDb } = await import("./db.server");
  return { userId, db: await getDb() };
}
export const saveIncidentAction = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { userId, db } = await deps();
    const { saveActionDraft } = await import("./incident-actions.server");
    await saveActionDraft(db, userId, data.id, data.draft, data.reviewedVersion);
    return { ok: true as const };
  });
export const sendIncidentAction = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const { userId, db } = await deps();
    const { sendPlannedAction } = await import("./incident-actions.server");
    const gmail = await import("./gmail.server");
    try {
      await sendPlannedAction(db, userId, data.id, data.draft, (input) =>
        gmail.sendMail(userId, getRequestUrl().origin, input),
      );
      return { ok: true as const };
    } catch (error) {
      if (error instanceof gmail.ReconnectRequired)
        return {
          ok: false as const,
          code: "RECONNECT" as const,
          message: "Connect or reconnect Gmail before sending.",
        };
      if (error instanceof gmail.SendUncertain)
        return {
          ok: false as const,
          code: "UNCERTAIN" as const,
          message:
            "Delivery is not confirmed. Check Gmail Sent, then retry the same action to reconcile it. The draft is locked to prevent duplicates.",
        };
      return {
        ok: false as const,
        code: "ERROR" as const,
        message:
          error instanceof Error
            ? error.message
            : "Could not send this action. Refresh and try again.",
      };
    }
  });
