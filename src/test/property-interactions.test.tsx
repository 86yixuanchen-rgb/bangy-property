import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropertiesSection } from "@/components/PropertiesSection";
const sync = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/case-workflow.functions", () => ({
  createContactDraft: vi.fn(),
  getPropertyContactHistory: vi.fn(),
  getCaseRecords: vi.fn(),
  closeCase: vi.fn(),
  getCaseFile: vi.fn(),
  uploadCaseFile: vi.fn(),
  recordQuoteDecision: vi.fn(),
  rescheduleVisit: vi.fn(),
  listFollowUps: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { name: "PM", email: "pm@example.test" } }),
}));
vi.mock("@/lib/workspace", () => ({
  useWorkspace: () => ({
    notify: vi.fn(),
    requests: [
      { id: "REQ-1", title: "Active leak", propertyId: 1, column: "New" },
      { id: "REQ-2", title: "Old repair", propertyId: 1, column: "Completed" },
    ],
  }),
}));
vi.mock("@/lib/workspace.functions", () => ({
  addProperty: vi.fn(),
  updateProperty: vi.fn(),
  deleteProperty: vi.fn(),
  syncPropertyEventContacts: sync,
  listProperties: async () => [
    {
      id: 1,
      address: "Test property",
      managerName: "PM",
      managerEmail: "pm@example.test",
      ownerName: "Owner",
      ownerEmail: "owner@example.test",
      tenantName: "New tenant",
      tenantEmail: "new@example.test",
      notes: "",
    },
  ],
  listAppointments: async () => [
    { id: 1, propertyId: 1, title: "Future visit", startsAt: Date.now() + 86400000 },
    { id: 2, propertyId: 1, title: "Previous visit", startsAt: Date.now() - 86400000 },
  ],
  listPropertyContactChanges: async () => [
    {
      requestId: "REQ-1",
      propertyId: 1,
      version: "review-version",
      current: [{ role: "Tenant", name: "Old tenant", email: "old@example.test" }],
      next: [{ role: "Tenant", name: "New tenant", email: "new@example.test" }],
    },
  ],
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Property interactions", () => {
  it("shows active work first and keeps completed events and past visits collapsed", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesSection />
      </QueryClientProvider>,
    );
    await screen.findByText("Test property");
    fireEvent.click(screen.getByRole("button", { name: "View property" }));
    expect(screen.getByText("REQ-1 · Active leak")).toBeVisible();
    const completed = screen.getByText(/Completed events/).closest("details")!;
    expect(completed.open).toBe(false);
    fireEvent.click(screen.getByText(/Completed events/));
    expect(completed.open).toBe(true);
    expect(screen.getByText(/Future visit/)).toBeVisible();
    expect(screen.getByText(/Past appointments/).closest("details")!.open).toBe(false);
  });
  it("requires a deliberate contact update after displaying old and current people", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PropertiesSection />
      </QueryClientProvider>,
    );
    await screen.findByText("Test property");
    fireEvent.click(screen.getByRole("button", { name: "View property" }));
    const review = await screen.findByText("Review contacts · REQ-1");
    expect(sync).not.toHaveBeenCalled();
    fireEvent.click(review);
    expect(screen.getByText(/Old tenant/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm contact update" }));
    expect(sync).toHaveBeenCalledWith({ data: { requestId: "REQ-1", version: "review-version" } });
  });
});
