import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Search,
  Plus,
  Filter,
  X,
  List,
  Columns3,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AppShell } from "@/components/AppShell";
import { RequestCard } from "@/components/RequestCard";
import { columns, priorityTone, type Priority } from "@/lib/data";
import { useWorkspace } from "@/lib/workspace";
import { loadSampleData } from "@/lib/workspace.functions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "list" | "board" } =>
    search["view"] === "board"
      ? { view: "board" }
      : search["view"] === "list"
        ? { view: "list" }
        : {},
  head: () => ({ meta: [{ title: "Repairs — RepairFlow" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { requests, loaded, loadError, retryRequests, addRequest, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [view, setView] = useState<"board" | "list">(search.view ?? "list");
  useEffect(() => {
    setView(search.view ?? "list");
  }, [search.view]);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"All" | Priority>("All");
  const [stage, setStage] = useState("Active");
  const [newOpen, setNewOpen] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const counts = {
    Active: requests.filter((r) => r.column !== "Completed").length,
    "Action Needed": requests.filter((r) => r.column === "Action Needed").length,
    Waiting: requests.filter((r) => r.column === "Waiting").length,
    Completed: requests.filter((r) => r.column === "Completed").length,
    All: requests.length,
  };
  const filtered = useMemo(
    () =>
      requests.filter(
        (r) =>
          (priority === "All" || r.priority === priority) &&
          (stage === "All" ||
            (stage === "Active" ? r.column !== "Completed" : r.column === stage)) &&
          [r.id, r.title, r.address, r.waitingOn, r.nextAction].some((value) =>
            value.toLowerCase().includes(query.trim().toLowerCase()),
          ),
      ),
    [requests, priority, stage, query],
  );
  return (
    <AppShell>
      <div className="repair-dashboard">
        <div className="page-heading">
          <div>
            <p className="page-eyebrow">WORKSPACE / REPAIRS</p>
            <h1>Repair requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every repair, a clear next step.</p>
          </div>
          <button onClick={() => setNewOpen(true)} className="primary-action">
            <Plus className="h-4 w-4" /> New request
          </button>
        </div>
        <div className="repair-tabs" role="group" aria-label="Filter repair status">
          {(["Active", "Action Needed", "Waiting", "Completed", "All"] as const).map((key) => (
            <button
              key={key}
              aria-pressed={stage === key}
              onClick={() => setStage(key)}
              className={stage === key ? "selected" : ""}
            >
              {key === "Action Needed" ? "Needs attention" : key === "All" ? "All requests" : key}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
        {counts["Action Needed"] > 0 && (
          <div className="attention-strip">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              <strong>
                {counts["Action Needed"]}{" "}
                {counts["Action Needed"] === 1 ? "repair needs" : "repairs need"} your attention.
              </strong>{" "}
              Review the next action to keep work moving.
            </span>
            <button
              onClick={() => setStage("Action Needed")}
              className="ml-auto inline-flex items-center gap-1 font-medium"
            >
              Review <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <section aria-label="Repair requests" className="repair-workspace">
          <div className="repair-toolbar">
            <label className="repair-search">
              <Search className="h-4 w-4" />
              <input
                aria-label="Search repairs"
                placeholder="Search repairs, properties or people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear repair search" onClick={() => setQuery("")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <label className="priority-filter">
              <Filter className="h-3.5 w-3.5" />
              <span className="sr-only">Priority</span>
              <select
                aria-label="Filter priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as "All" | Priority)}
              >
                {["All", "Urgent", "High", "Medium", "Low"].map((p) => (
                  <option key={p} value={p}>
                    {p === "All" ? "All priorities" : p}
                  </option>
                ))}
              </select>
            </label>
            <div className="view-switch" role="group" aria-label="View">
              {(["list", "board"] as const).map((key) => (
                <button
                  key={key}
                  aria-label={`${key === "list" ? "List" : "Board"} view`}
                  aria-pressed={view === key}
                  onClick={() => {
                    setView(key);
                    void navigate({ to: "/", search: { view: key } });
                  }}
                >
                  {key === "list" ? <List className="h-4 w-4" /> : <Columns3 className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
          {loadError ? (
            <div role="alert" className="repair-empty">
              <AlertCircle className="h-7 w-7 text-attention" />
              <h2>Could not load repairs</h2>
              <p>Check your connection and try again.</p>
              <button onClick={retryRequests} className="secondary-action mt-4">
                Try again
              </button>
            </div>
          ) : !loaded ? (
            <div role="status" className="p-12 text-center text-sm text-muted-foreground">
              Loading repair requests…
            </div>
          ) : requests.length === 0 ? (
            <div className="repair-empty">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <h2>No repair requests yet</h2>
              <p>Create a request or connect Gmail to bring repair emails into your workspace.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button onClick={() => setNewOpen(true)} className="primary-action">
                  Create first request
                </button>
                <button
                  disabled={loadingSample}
                  className="secondary-action"
                  onClick={async () => {
                    setLoadingSample(true);
                    try {
                      await loadSampleData();
                      await queryClient.invalidateQueries({ queryKey: ["requests"] });
                      notify("Clearly labelled sample requests loaded");
                    } catch {
                      notify("Could not load sample requests. Please try again.");
                    } finally {
                      setLoadingSample(false);
                    }
                  }}
                >
                  {loadingSample ? "Loading…" : "Explore sample data"}
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="repair-empty">
              <Search className="h-7 w-7 text-muted-foreground" />
              <h2>No matching repairs</h2>
              <p>Try a different search or clear your filters.</p>
              <button
                className="secondary-action mt-4"
                onClick={() => {
                  setQuery("");
                  setPriority("All");
                  setStage("All");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : view === "list" ? (
            <div className="repair-table-scroll">
              <table className="repair-table">
                <thead>
                  <tr>
                    <th>Repair / property</th>
                    <th>Status</th>
                    <th>Next to act</th>
                    <th>Next action</th>
                    <th>Last update</th>
                    <th>
                      <span className="sr-only">Open request</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          to="/requests/$id"
                          params={{ id: r.id }}
                          className="repair-title-link"
                        >
                          <span className="repair-reference">
                            {r.id}
                            <span className={`priority-label ${priorityTone[r.priority]}`}>
                              {r.priority}
                            </span>
                          </span>
                          <strong>{r.title}</strong>
                          <span className="repair-address">{r.address}</span>
                        </Link>
                      </td>
                      <td data-label="Status">
                        <span className="repair-status">
                          <span
                            className={`status-dot ${columns.find((c) => c.name === r.column)?.dot ?? "bg-muted-foreground"}`}
                          />
                          {r.column}
                        </span>
                        <span className="block mt-1 text-xs text-muted-foreground">{r.status}</span>
                      </td>
                      <td data-label="Next to act">
                        <span className="actor-avatar">{r.waitingOn.charAt(0)}</span>
                        <span>{r.waitingOn || "Unassigned"}</span>
                      </td>
                      <td data-label="Next action" className="next-action-cell">
                        {r.nextAction || "Next action to be confirmed"}
                      </td>
                      <td data-label="Updated" className="text-xs text-muted-foreground">
                        {r.lastUpdate}
                      </td>
                      <td>
                        <Link
                          to="/requests/$id"
                          params={{ id: r.id }}
                          aria-label={`Open ${r.id}`}
                          className="table-open"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="repair-board-scroll">
              <div className="repair-board">
                {columns.map((c) => (
                  <section key={c.name}>
                    <div className="board-heading">
                      <span className={`status-dot ${c.dot}`} />
                      <h3>{c.name}</h3>
                      <span>{filtered.filter((r) => r.column === c.name).length}</span>
                    </div>
                    <div className="space-y-3">
                      {filtered
                        .filter((r) => r.column === c.name)
                        .map((r) => (
                          <RequestCard key={r.id} r={r} />
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
          {loaded && requests.length > 0 && (
            <footer className="repair-list-footer" aria-live="polite" aria-atomic="true">
              <span>
                {filtered.length} of {requests.length} requests
              </span>
              <span>Select a repair to review its next action</span>
            </footer>
          )}
        </section>
      </div>
      {newOpen && (
        <CreateRequest
          onClose={() => setNewOpen(false)}
          onSubmit={async (input) => {
            const item = await addRequest(input);
            setNewOpen(false);
            notify(`${item.id} created`);
            void navigate({ to: "/requests/$id", params: { id: item.id } });
          }}
        />
      )}
    </AppShell>
  );
}

function CreateRequest({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: { title: string; address: string; priority: Priority }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto bg-card p-6">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            setSaveError("");
            try {
              await onSubmit({ title, address, priority });
            } catch {
              setSaveError("Could not create the request. Please try again.");
            } finally {
              setSaving(false);
            }
          }}
          className="w-full"
        >
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-semibold">Create repair request</DialogTitle>
              <DialogDescription>Add a new issue to the triage queue.</DialogDescription>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium">
              Issue
              <input
                required
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Leaking bathroom tap"
                className="mt-1 h-10 w-full rounded-md border px-3 font-normal outline-none focus:border-ring"
              />
            </label>
            <label className="block text-sm font-medium">
              Property address
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. 12 Hill St, Newtown"
                className="mt-1 h-10 w-full rounded-md border px-3 font-normal outline-none focus:border-ring"
              />
            </label>
            <label className="block text-sm font-medium">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="mt-1 h-10 w-full rounded-md border bg-card px-3 font-normal"
              >
                <option>Urgent</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </label>
          </div>
          {saveError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {saveError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Creating request…" : "Create request"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
