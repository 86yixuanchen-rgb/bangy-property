import { z } from "zod";
export const actionKinds = [
  "acknowledge_tenant",
  "request_details",
  "notify_landlord",
  "request_quote",
  "request_approval",
  "arrange_repair",
  "confirm_resolution",
  "contact_tenant",
  "contact_landlord",
  "contact_team",
  "contact_pm",
] as const;
export type ActionKind = (typeof actionKinds)[number];
export const actionRole: Record<
  ActionKind,
  "Tenant" | "Landlord" | "Repair Team" | "Property Manager"
> = {
  acknowledge_tenant: "Tenant",
  request_details: "Tenant",
  notify_landlord: "Landlord",
  request_quote: "Repair Team",
  request_approval: "Landlord",
  arrange_repair: "Repair Team",
  confirm_resolution: "Tenant",
  contact_tenant: "Tenant",
  contact_landlord: "Landlord",
  contact_team: "Repair Team",
  contact_pm: "Property Manager",
};
export const plannedAction = z.object({
  kind: z.enum(actionKinds),
  title: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  recipientEmail: z.string().trim().toLowerCase().email().nullable(),
  quoteId: z.number().int().positive().nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
});
export type PlannedAction = z.infer<typeof plannedAction>;
export const actionDraft = z.object({
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
});
export type ActionDraft = z.infer<typeof actionDraft>;

export const expectsReply = (kind: ActionKind) =>
  kind !== "notify_landlord" && kind !== "acknowledge_tenant" && !kind.startsWith("contact_");
