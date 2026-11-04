import { describe, expect, it } from "vitest";
import {
  defaultRepairPreferences,
  readRepairPreferences,
  selectRepairs,
} from "@/lib/repair-filters";
import { requests } from "@/lib/data";

describe("Repair list preferences", () => {
  it("combines status, contact search and urgency without modifying records", () => {
    const before = structuredClone(requests);
    const result = selectRepairs(requests, {
      ...defaultRepairPreferences,
      status: "Waiting",
      priority: "High",
      query: "HELEN",
    });
    expect(result.map((r) => r.id)).toEqual(["REQ-087"]);
    expect(requests).toEqual(before);
  });
  it("keeps completed repairs out of Open and includes them when filters are cleared", () => {
    expect(
      selectRepairs(requests, defaultRepairPreferences).some((r) => r.column === "Completed"),
    ).toBe(false);
    expect(selectRepairs(requests, { ...defaultRepairPreferences, status: "All" })).toHaveLength(
      requests.length,
    );
  });
  it("filters by the actual stakeholder instead of confusing them with the manager", () => {
    const result = selectRepairs(requests, {
      ...defaultRepairPreferences,
      responsibility: "Landlord · David Chen",
    });
    expect(result.map((r) => r.id)).toEqual(["REQ-101"]);
    expect(
      selectRepairs(requests, {
        ...defaultRepairPreferences,
        responsibility: "Property Manager",
      }).every((r) => r.waitingOn === "Property Manager"),
    ).toBe(true);
  });
  it("sorts urgency predictably in either direction and preserves the source array", () => {
    const urgent = selectRepairs(requests, { ...defaultRepairPreferences, direction: "asc" });
    const low = selectRepairs(requests, { ...defaultRepairPreferences, direction: "desc" });
    expect(urgent[0]?.priority).toBe("Urgent");
    expect(low[0]?.priority).toBe("Low");
  });
  it("recovers from corrupt preferences and distinguishes an unmatched search", () => {
    expect(readRepairPreferences({ status: "deleted", sort: "revenue" })).toEqual(
      defaultRepairPreferences,
    );
    expect(
      selectRepairs(requests, { ...defaultRepairPreferences, query: "no-such-property-xyz" }),
    ).toEqual([]);
  });
});
