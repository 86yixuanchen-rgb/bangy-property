// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseActionArgs, normalizePlanDependencies } from "@/lib/assistant-actions";
import { sydneyTimestamp, timeDisplay } from "@/lib/appointment-time";
describe("Assistant validation and calendar time", () => {
  it("uses Sydney offset independently of browser timezone", () => {
    expect(new Date(Number(sydneyTimestamp("2026-11-12T10:00"))).toISOString()).toBe(
      "2026-11-11T23:00:00.000Z",
    );
    expect(timeDisplay(Date.parse("2026-07-01T00:00:00Z"))).toBe("2026-07-01T10:00");
  });
  it("rejects nonexistent daylight-saving time", () => {
    expect(() => sydneyTimestamp("2026-10-04T02:30")).toThrow("does not exist");
  });
  it("requires an explicit timezone for model-provided dates", () => {
    expect(() =>
      parseActionArgs("appointment.create", {
        propertyId: 1,
        title: "Visit",
        startsAt: "2026-11-12T10:00",
        endsAt: "2026-11-12T11:00",
      }),
    ).toThrow("timezone");
  });
  it("adds dependencies for edits to a property used by a subsequent event", () => {
    const result = normalizePlanDependencies([
      {
        action: "contact.associate",
        args: { id: "contact", propertyId: 4, role: "Tenant" },
        dependsOn: [],
      },
      {
        action: "event.create",
        args: { propertyId: 4, title: "Tap", priority: "High" },
        dependsOn: [],
      },
    ]);
    expect(result[1]!.dependsOn).toEqual([1]);
  });
  it("does not serialize unrelated property operations", () => {
    const result = normalizePlanDependencies([
      {
        action: "contact.associate",
        args: { id: "contact", propertyId: 4, role: "Tenant" },
        dependsOn: [],
      },
      {
        action: "event.create",
        args: { propertyId: 5, title: "Tap", priority: "High" },
        dependsOn: [],
      },
    ]);
    expect(result[1]!.dependsOn).toEqual([]);
  });
});

import { dependencies, resolveActionReferences } from "@/lib/assistant-actions";
it("resolves file references inside an attachment list and adds their dependency", () => {
  const step = { action: "email.draft", args: { attachmentIds: ["$1.id"] }, dependsOn: [] };
  expect(dependencies(step)).toEqual([1]);
  expect(
    resolveActionReferences(step.args, (position, key) =>
      position === 1 && key === "id" ? "file-id" : null,
    ),
  ).toEqual({ attachmentIds: ["file-id"] });
});
