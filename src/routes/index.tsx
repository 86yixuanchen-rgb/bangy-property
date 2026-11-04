import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ArrowUpRight,
  AlertCircle,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Columns3,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequestCard } from "@/components/RequestCard";
import { Button } from "@/components/ui/button";
import {
  PageHeading,
  StatusLabel,
  ErrorState,
  EmptyState,
  LoadingRows,
  PendingLabel,
  FormDialog,
} from "@/components/workspace-ui";
import { columns, priorityTone, type Priority, type RepairRequest } from "@/lib/data";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import { loadSampleData } from "@/lib/workspace.functions";
import {
  defaultRepairPreferences,
  readRepairPreferences,
  selectRepairs,
  type RepairPreferences,
} from "@/lib/repair-filters";
import { useAsyncAction, useDebouncedValue, useStoredPreference } from "@/hooks/use-ui-state";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "list" | "board" } =>
    search["view"] === "list" || search["view"] === "board" ? { view: search["view"] } : {},
  head: () => ({ meta: [{ title: "Maintenance overview — RepairFlow" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { requests, loaded, loadError, permissionError, retryRequests, notify } = useWorkspace();
  const { user } = useAuth();
  const [preferences, setPreferences] = useStoredPreference(
    user?.email ? `repairflow.repairs.v2:${user.email}` : null,
    defaultRepairPreferences,
    readRepairPreferences,
    "sessionStorage",
  );
  const routeSearch = Route.useSearch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [aiSignal, setAiSignal] = useState(0);
  const sample = useAsyncAction();
  useEffect(() => {
    if (routeSearch.view) setPreferences((p) => ({ ...p, view: routeSearch.view! }));
  }, [routeSearch.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const debouncedQuery = useDebouncedValue(preferences.query);
  const filtered = useMemo(
    () =>
      selectRepairs(requests, { ...preferences, query: preferences.query ? debouncedQuery : "" }),
    [requests, preferences, debouncedQuery],
  );
  const responsibilityOptions = [
    ...new Set([
      ...requests.map((r) => r.waitingOn),
      ...(preferences.responsibility === "All" ? [] : [preferences.responsibility]),
    ]),
  ]
    .filter(Boolean)
    .sort();
  const summaries = [
    {
      label: "Open repairs",
      value: requests.filter((r) => r.column !== "Completed").length,
      status: "Active",
      icon: ClipboardList,
      tone: "blue",
    },
    {
      label: "Needs attention",
      value: requests.filter((r) => r.column === "Action Needed").length,
      status: "Action Needed",
      icon: AlertCircle,
      tone: "amber",
    },
    {
      label: "Waiting for response",
      value: requests.filter((r) => r.column === "Waiting").length,
      status: "Waiting",
      icon: Clock3,
      tone: "neutral",
    },
    {
      label: "Scheduled repairs",
      value: requests.filter((r) => r.column === "Scheduled").length,
      status: "Scheduled",
      icon: CheckCircle2,
      tone: "green",
    },
  ] as const;
  const attention = requests.filter((r) => r.column === "Action Needed").slice(0, 3);
  const activeFilters = [
    preferences.status !== "All"
      ? {
          label: preferences.status === "Action Needed" ? "Needs attention" : preferences.status,
          key: "status" as const,
        }
      : null,
    preferences.priority !== "All"
      ? { label: preferences.priority, key: "priority" as const }
      : null,
    preferences.responsibility !== "All"
      ? { label: preferences.responsibility, key: "responsibility" as const }
      : null,
  ].filter((x) => x !== null);
  const update = <K extends keyof RepairPreferences>(key: K, value: RepairPreferences[K]) =>
    setPreferences((p) => ({ ...p, [key]: value }));
  const clear = () =>
    setPreferences((p) => ({ ...defaultRepairPreferences, status: "All", view: p.view }));
  const changeSort = (sort: RepairPreferences["sort"]) =>
    setPreferences((p) => ({
      ...p,
      sort,
      direction: p.sort === sort && p.direction === "asc" ? "desc" : "asc",
    }));
  const sortHeader = (label: string, key: RepairPreferences["sort"]) => (
    <button onClick={() => changeSort(key)}>
      {label}
      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
  return (
    <AppShell openAssistantSignal={aiSignal}>
      <div className="overview-page">
        <PageHeading
          title="Maintenance overview"
          description="Track outstanding repairs, who needs to act, and what happens next."
          action={
            <Button onClick={() => setNewOpen(true)}>
              <Plus />
              Create repair
            </Button>
          }
        />
        {loadError && (
          <ErrorState
            message={
              permissionError
                ? "Your session could not be authorised. Sign in again to load your repairs."
                : "We couldn’t load your repairs. Check your connection and try again."
            }
            {...(!permissionError ? { retry: retryRequests } : {})}
          />
        )}
        {permissionError && (
          <Button asChild variant="outline" className="mb-4">
            <Link to="/login">Sign in again</Link>
          </Button>
        )}
        <section className="summary-grid" aria-label="Repair summaries">
          {summaries.map((s) => (
            <button
              key={s.label}
              className={`summary-panel summary-${s.tone}`}
              aria-pressed={preferences.status === s.status}
              onClick={() => {
                setPreferences({ ...defaultRepairPreferences, status: s.status });
                document
                  .getElementById("repair-requests")
                  ?.scrollIntoView({ block: "start", behavior: "instant" });
              }}
            >
              <span className="summary-icon">
                <s.icon />
              </span>
              <span className="summary-text">
                <span>{s.label}</span>
                <strong>{loaded ? s.value.toLocaleString("en-AU") : "—"}</strong>
              </span>
              <ArrowUpRight className="summary-link" />
            </button>
          ))}
        </section>
        <section
          id="repair-requests"
          className="surface repairs-surface"
          aria-labelledby="repairs-heading"
        >
          <header className="surface-heading">
            <div>
              <h2 id="repairs-heading">
                Repair requests{" "}
                <span className="count-label">{loaded ? requests.length : "—"}</span>
              </h2>
              <p>Keep every repair moving with a clear next action.</p>
            </div>
            <div className="view-switch" role="group" aria-label="Repair view">
              {(["list", "board"] as const).map((view) => (
                <button
                  key={view}
                  aria-label={view === "list" ? "Table view" : "By stage view"}
                  title={view === "list" ? "Table view" : "By stage view"}
                  aria-pressed={preferences.view === view}
                  onClick={() => update("view", view)}
                >
                  {view === "list" ? <List /> : <Columns3 />}
                </button>
              ))}
            </div>
          </header>
          <div className="repair-filters">
            <label className="repair-search">
              <Search aria-hidden="true" />
              <input
                aria-label="Search repairs"
                placeholder="Search issue, property or contact…"
                value={preferences.query}
                onChange={(e) => update("query", e.target.value)}
              />
              {preferences.query && (
                <button aria-label="Clear search" onClick={() => update("query", "")}>
                  <X />
                </button>
              )}
            </label>
            <label className="filter-field">
              <span>Status</span>
              <select
                aria-label="Filter status"
                value={preferences.status}
                onChange={(e) => update("status", e.target.value as RepairPreferences["status"])}
              >
                <option value="All">All statuses</option>
                <option value="Active">Open repairs</option>
                {columns.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Responsibility</span>
              <select
                aria-label="Filter responsibility"
                value={preferences.responsibility}
                onChange={(e) => update("responsibility", e.target.value)}
              >
                <option value="All">Anyone</option>
                {responsibilityOptions.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Urgency</span>
              <select
                aria-label="Filter urgency"
                value={preferences.priority}
                onChange={(e) =>
                  update("priority", e.target.value as RepairPreferences["priority"])
                }
              >
                {["All", "Urgent", "High", "Medium", "Low"].map((o) => (
                  <option key={o} value={o}>
                    {o === "All" ? "Any urgency" : o}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field sort-field">
              <span>Sort by</span>
              <select
                aria-label="Sort repairs"
                value={preferences.sort}
                onChange={(e) => update("sort", e.target.value as RepairPreferences["sort"])}
              >
                <option value="priority">Urgency</option>
                <option value="issue">Issue</option>
                <option value="property">Property</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
          <div className="active-filters">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setPreferences((p) => ({ ...p, [f.key]: "All" }))}
                aria-label={`Remove ${f.label} filter`}
              >
                {f.label}
                <X />
              </button>
            ))}
            <button className="clear-filters" onClick={clear}>
              Clear filters
            </button>
            <span className="filter-results" role="status" aria-live="polite">
              {preferences.query !== debouncedQuery && preferences.query
                ? "Updating results…"
                : `${filtered.length} ${filtered.length === 1 ? "repair" : "repairs"}`}
            </span>
          </div>
          {!loaded && !loadError ? (
            <LoadingRows />
          ) : loaded && requests.length === 0 ? (
            <EmptyState
              title="Your first repair starts here"
              description="Create a repair or connect Gmail to review incoming maintenance emails."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setNewOpen(true)}>Create repair</Button>
                  <Button
                    variant="outline"
                    disabled={sample.pending}
                    onClick={() =>
                      void sample.run(async () => {
                        const result = await loadSampleData();
                        if (!result.ok) {
                          await queryClient.invalidateQueries({ queryKey: ["requests"] });
                          throw new Error("Sample load was not confirmed");
                        }
                        await queryClient.invalidateQueries({ queryKey: ["requests"] });
                        notify("Sample repairs loaded");
                      }, "Could not load sample repairs. Please try again.")
                    }
                  >
                    {sample.pending ? "Loading…" : "Explore sample data"}
                  </Button>
                </div>
              }
            />
          ) : loaded && filtered.length === 0 ? (
            <EmptyState
              search
              title="No repairs match your filters"
              description="Try a different search or clear your filters to see more repairs."
              action={
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : preferences.view === "list" ? (
            <div className="repair-table-wrap">
              <table className="repair-table">
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        preferences.sort === "issue"
                          ? preferences.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {sortHeader("Repair issue", "issue")}
                    </th>
                    <th
                      className="table-property"
                      aria-sort={
                        preferences.sort === "property"
                          ? preferences.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {sortHeader("Property", "property")}
                    </th>
                    <th
                      aria-sort={
                        preferences.sort === "status"
                          ? preferences.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {sortHeader("Status", "status")}
                    </th>
                    <th>Next to act</th>
                    <th>Next action</th>
                    <th className="table-updated">Last update</th>
                    <th>
                      <span className="sr-only">Open repair</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Repair issue">
                        <Link to="/requests/$id" params={{ id: r.id }} className="repair-title">
                          <span>
                            {r.id}
                            <span className={`priority-label ${priorityTone[r.priority]}`}>
                              {r.priority}
                            </span>
                          </span>
                          <strong>{r.title}</strong>
                          <span className="compact-address">{r.address}</span>
                        </Link>
                      </td>
                      <td data-label="Property" className="table-property">
                        {r.address}
                      </td>
                      <td data-label="Status">
                        <StatusLabel status={r.column} />
                        <span className="status-description">{r.status}</span>
                      </td>
                      <td data-label="Next to act">
                        <span className="actor-label">{r.waitingOn || "Unassigned"}</span>
                      </td>
                      <td data-label="Next action" className="table-next">
                        {r.nextAction || "Next action to be confirmed"}
                      </td>
                      <td data-label="Last update" className="table-updated">
                        {r.lastUpdate}
                      </td>
                      <td className="table-open">
                        <Link to="/requests/$id" params={{ id: r.id }} aria-label={`Open ${r.id}`}>
                          <ArrowUpRight />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stage-list">
              {columns.map((c) => (
                <details className="stage-lane" key={c.name} open>
                  <summary>
                    <StatusLabel status={c.name} />
                    <span>{filtered.filter((r) => r.column === c.name).length}</span>
                  </summary>
                  {filtered
                    .filter((r) => r.column === c.name)
                    .map((r) => (
                      <RequestCard key={r.id} r={r} />
                    ))}
                  {filtered.every((r) => r.column !== c.name) && (
                    <p className="p-4 text-sm text-muted-foreground">
                      No matching repairs in this stage.
                    </p>
                  )}
                </details>
              ))}
            </div>
          )}
          {sample.error && <ErrorState message={sample.error} />}
          {loaded && requests.length > 0 && (
            <footer className="table-footer">
              Showing {filtered.length} of {requests.length} repairs
              <span>Last update is shown where due dates are unavailable.</span>
            </footer>
          )}
        </section>
        <section className="surface attention-surface" aria-label="Needs attention">
          <header className="surface-heading">
            <div>
              <h2>Needs attention</h2>
              <p>Repairs marked for manager action.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAiSignal((v) => v + 1)}>
              Ask AI to prioritise
            </Button>
          </header>
          {attention.length ? (
            <div className="attention-queue">
              {attention.map((r) => (
                <Link key={r.id} to="/requests/$id" params={{ id: r.id }}>
                  <span
                    className={`attention-indicator ${r.priority === "Urgent" ? "urgent" : ""}`}
                  />
                  <span>
                    <strong>{r.title}</strong>
                    <small>{r.address}</small>
                    <span>{r.nextAction}</span>
                  </span>
                  <ArrowUpRight />
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              No requests currently need attention.
            </p>
          )}
        </section>
      </div>
      {newOpen && (
        <CreateRepairDialog
          onClose={() => setNewOpen(false)}
          onCreated={(r) => {
            notify(`${r.id} created`);
            void navigate({ to: "/requests/$id", params: { id: r.id } });
          }}
        />
      )}
    </AppShell>
  );
}

function CreateRepairDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: RepairRequest) => void;
}) {
  const { addRequest } = useWorkspace();
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const action = useAsyncAction();
  return (
    <FormDialog
      title="Create repair"
      description="Add the issue and property. The repair starts in New, ready for manager review."
      dirty={Boolean(title || address || priority !== "Medium")}
      busy={action.pending}
      onClose={onClose}
    >
      {({ close, finish }) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const item = await addRequest({
                title: title.trim(),
                address: address.trim(),
                priority,
              });
              finish();
              onCreated(item);
            }, "Could not create this repair. Your details have been kept. Please try again.");
          }}
          className="form-stack"
        >
          <label>
            Repair issue
            <input
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kitchen tap leaking"
            />
          </label>
          <label>
            Property address
            <input
              required
              maxLength={300}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street address and unit number"
            />
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {["Urgent", "High", "Medium", "Low"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          {action.error && <ErrorState message={action.error} />}
          <div className="form-actions">
            <Button type="button" variant="outline" disabled={action.pending} onClick={close}>
              Cancel
            </Button>
            <Button disabled={action.pending || !title.trim() || !address.trim()}>
              {action.pending ? <PendingLabel>Creating…</PendingLabel> : "Create repair"}
            </Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
