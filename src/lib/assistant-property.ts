import { z } from "zod";
const emailOrEmpty = z.union([z.string().trim().toLowerCase().email().max(200), z.literal("")]);
export const assistantContext = z.object({
  evidenceEmailIds: z.array(z.string().min(1).max(300)).max(10).optional(),
  propertyId: z.number().int().positive().optional(),
  appointmentId: z.number().int().positive().optional(),
  emailId: z.string().min(1).max(300).optional(),
  requestId: z
    .string()
    .regex(/^REQ-\d+$/)
    .optional(),
});
export type AssistantContext = z.infer<typeof assistantContext>;
export const propertyFields = z.object({
  address: z.string().trim().max(300),
  managerName: z.string().trim().max(100),
  managerEmail: emailOrEmpty,
  ownerName: z.string().trim().max(100),
  ownerEmail: emailOrEmpty,
  tenantName: z.string().trim().max(100),
  tenantEmail: emailOrEmpty,
  notes: z.string().trim().max(1000),
});
export type PropertyFields = z.infer<typeof propertyFields>;
export type AssistantPropertyDraft = {
  fields: PropertyFields;
  source: string;
  sourceEmailId: string | null;
  requestId: string | null;
  canLink: boolean;
};
export const isPropertyCreation = (question: string) =>
  /property|properties|房产|房屋|物业/i.test(question) &&
  /creat|add|register|save|创建|新建|新增|添加|录入|加进去|建一下/i.test(question);
export const normalizeAddress = (address: string) =>
  address.trim().replace(/\s+/g, " ").toLowerCase();
// Conservative local prefill. Unrecognised addresses stay blank for review.
export function extractPropertyAddress(text: string) {
  const street =
    /\b\d+[A-Za-z]?(?:\s*\/\s*\d+[A-Za-z]?)?\s+[\w'’ -]+?\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Crescent|Cres|Place|Pl|Parade|Pde|Way|Terrace|Tce)\b(?:,\s*[A-Za-z][A-Za-z'’ ]*)?/i;
  const match = text.match(street);
  return match?.[0].trim().slice(0, 300) ?? "";
}
