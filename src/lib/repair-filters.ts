import { z } from "zod";
import type { RepairRequest } from "./data";

export const repairPreferencesSchema = z.object({
  query: z.string().max(300),
  status: z.enum(["All", "Active", "New", "Waiting", "Action Needed", "Scheduled", "Completed"]),
  responsibility: z.string().max(200),
  priority: z.enum(["All", "Urgent", "High", "Medium", "Low"]),
  sort: z.enum(["priority", "issue", "property", "status"]),
  direction: z.enum(["asc", "desc"]),
  view: z.enum(["list", "board"]),
});
export type RepairPreferences = z.infer<typeof repairPreferencesSchema>;
export const defaultRepairPreferences: RepairPreferences = {
  query: "",
  status: "Active",
  responsibility: "All",
  priority: "All",
  sort: "priority",
  direction: "asc",
  view: "list",
};
export function readRepairPreferences(value: unknown) {
  return repairPreferencesSchema.safeParse(value).data ?? defaultRepairPreferences;
}
const priorityOrder = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const statusOrder = { New: 0, "Action Needed": 1, Waiting: 2, Scheduled: 3, Completed: 4 };
export function selectRepairs(
  requests: RepairRequest[],
  preferences: RepairPreferences,
): RepairRequest[] {
  const q = preferences.query.trim().toLocaleLowerCase();
  return requests
    .filter(
      (r) =>
        (preferences.status === "All" ||
          (preferences.status === "Active"
            ? r.column !== "Completed"
            : r.column === preferences.status)) &&
        (preferences.priority === "All" || r.priority === preferences.priority) &&
        (preferences.responsibility === "All" || r.waitingOn === preferences.responsibility) &&
        (!q ||
          [r.title, r.address, r.waitingOn, r.id, r.nextAction].some((v) =>
            v.toLocaleLowerCase().includes(q),
          )),
    )
    .sort((a, b) => {
      const compared =
        preferences.sort === "priority"
          ? priorityOrder[a.priority] - priorityOrder[b.priority]
          : preferences.sort === "status"
            ? statusOrder[a.column] - statusOrder[b.column]
            : preferences.sort === "issue"
              ? a.title.localeCompare(b.title)
              : a.address.localeCompare(b.address);
      return (
        compared * (preferences.direction === "asc" ? 1 : -1) ||
        a.id.localeCompare(b.id, undefined, { numeric: true })
      );
    });
}
