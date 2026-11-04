import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace";
import { requests } from "@/lib/data";
const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock("@/lib/requests.functions", () => ({
  listRequests: api.list,
  createRequest: api.create,
  patchRequest: api.patch,
}));
let workspace: ReturnType<typeof useWorkspace>;
function Probe() {
  workspace = useWorkspace();
  return <div>{workspace.requests[0]?.column}</div>;
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["requests"], [{ ...requests[0]! }]);
  render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Server-confirmed repair changes", () => {
  it("does not show an approval or status change while its request is pending", async () => {
    let confirm!: (value: { ok: true }) => void;
    api.patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const client = setup();
    let saving!: Promise<void>;
    act(() => {
      saving = workspace.updateRequest("REQ-108", { column: "Completed" });
    });
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(client.getQueryData<Array<{ column: string }>>(["requests"])?.[0]?.column).toBe("New");
    await act(async () => {
      confirm({ ok: true });
      await saving;
    });
    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
    expect(api.patch).toHaveBeenCalledWith({
      data: { id: "REQ-108", patch: { column: "Completed" } },
    });
  });
  it("preserves the confirmed record and propagates a failed save to the UI", async () => {
    api.patch.mockRejectedValue(new Error("Network unavailable"));
    setup();
    await act(async () => {
      await expect(workspace.updateRequest("REQ-108", { column: "Completed" })).rejects.toThrow(
        "Network unavailable",
      );
    });
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(workspace.toasts).toEqual([]);
  });
  it("does not treat an unconfirmed API result as success", async () => {
    api.patch.mockResolvedValue({ ok: false });
    setup();
    await act(async () => {
      await expect(workspace.updateRequest("REQ-108", { column: "Completed" })).rejects.toThrow(
        "not confirmed",
      );
    });
    await waitFor(() => expect(screen.getByText("New")).toBeInTheDocument());
  });
});
