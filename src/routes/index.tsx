import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Hourglass,
  AlertCircle,
  CalendarCheck,
  Bot,
  ChevronRight,
  Plus,
  Filter,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequestCard } from "@/components/RequestCard";
import { columns, priorityTone, type Priority } from "@/lib/data";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import { listAppointments, loadSampleData } from "@/lib/workspace.functions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "list" } =>
    search["view"] === "list" ? { view: "list" } : {},
  head: () => ({
    meta: [
      { title: "Home — RepairFlow" },
      {
        name: "description",
        content: "See every repair request, who it's waiting on and what happens next.",
      },
    ],
  }),
  component: Dashboard,
});
function Dashboard() {
  const { requests, loaded, addRequest, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => listAppointments(),
  });
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [view, setView] = useState<"board" | "list">(search.view === "list" ? "list" : "board");
  useEffect(() => {
    setView(search.view === "list" ? "list" : "board");
  }, [search.view]);
  const [priority, setPriority] = useState<"All" | Priority>("All");
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]}`;
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const [newOpen, setNewOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState(0);
  const filtered = useMemo(
    () => (priority === "All" ? requests : requests.filter((item) => item.priority === priority)),
    [requests, priority],
  );
  const attentionAll = useMemo(() => {
    const weight = { Urgent: 0, High: 1, Medium: 2, Low: 3 } as const;
    return requests
      .filter(
        (r) =>
          r.column !== "Completed" &&
          (r.column === "Action Needed" || r.priority === "Urgent" || r.priority === "High"),
      )
      .sort(
        (a, b) =>
          Number(b.column === "Action Needed") - Number(a.column === "Action Needed") ||
          weight[a.priority] - weight[b.priority],
      );
  }, [requests]);
  const briefing = attentionAll.slice(0, 3);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const scheduledToday = appointments.filter(
    (a) =>
      a.startsAt >= startOfDay.getTime() && a.startsAt < startOfDay.getTime() + 24 * 3600 * 1000,
  ).length;
  const stats = [
    {
      label: "Active Requests",
      value: requests.filter((r) => r.column !== "Completed").length,
      icon: Activity,
      tone: "text-primary bg-primary-soft",
    },
    {
      label: "Waiting",
      value: requests.filter((r) => r.column === "Waiting").length,
      icon: Hourglass,
      tone: "text-waiting bg-waiting-soft",
    },
    {
      label: "Need Attention",
      value: requests.filter((r) => r.column === "Action Needed").length,
      icon: AlertCircle,
      tone: "text-attention bg-attention-soft",
    },
    {
      label: "Scheduled Today",
      value: scheduledToday,
      icon: CalendarCheck,
      tone: "text-scheduled bg-scheduled-soft",
    },
  ];
  return (
    <AppShell openAssistantSignal={aiSeed}>
      <div className="home-dashboard">
        <div className="home-heading">
          <div>
            <p className="text-sm text-muted-foreground">{dateStr}</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}, {user?.name ?? "there"}
            </h1>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Create request
          </button>
        </div>
        <div className="home-facts">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-card sm:p-5"
            >
              <div className={`grid h-10 w-10 place-items-center rounded-md ${s.tone}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{s.value}</div>
                <div className="text-xs text-muted-foreground sm:text-sm">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="operations-grid">
          {requests.length > 0 ? (
            <section className="home-briefing">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-ai-soft text-ai">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-ai">
                      Morning briefing
                    </div>
                    <h2 className="font-semibold">
                      {attentionAll.length === 0
                        ? "Nothing needs your attention right now"
                        : `${attentionAll.length} ${attentionAll.length === 1 ? "request needs" : "requests need"} your attention`}
                    </h2>
                  </div>
                </div>
                <button
                  onClick={() => setAiSeed((v) => v + 1)}
                  className="rounded-md border border-ai/30 bg-ai-soft px-3 py-2 text-sm font-medium text-ai hover:opacity-90"
                >
                  Ask AI to prioritise my day
                </button>
              </div>
              <div className="mt-4 divide-y rounded-md border">
                {briefing.map((b) => (
                  <Link
                    key={b.id}
                    to="/requests/$id"
                    params={{ id: b.id }}
                    className="flex items-center gap-3 px-3 py-3 text-sm hover:bg-muted"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-attention" />
                    <span className="font-mono text-xs text-muted-foreground">{b.id}</span>
                    <span className="hidden w-36 truncate font-medium sm:block">{b.title}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {b.column === "Action Needed" ? "Action needed" : `${b.priority} priority`} ·{" "}
                      {b.nextAction}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {loaded && requests.length === 0 ? (
            <section className="home-empty">
              <h2 className="text-lg font-semibold">No repair requests yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Create your first request, or connect Gmail in the Inbox and create requests from
                tenant emails. Want to look around first? Load a few clearly labelled sample
                requests.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setNewOpen(true)}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  New request
                </button>
                <button
                  onClick={() =>
                    void loadSampleData().then(() => {
                      notify("Sample requests loaded");
                      return queryClient.invalidateQueries({ queryKey: ["requests"] });
                    })
                  }
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Load sample data
                </button>
              </div>
            </section>
          ) : null}
          <section className="operations-workflow">
            <div className="workflow-toolbar mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold">Repair workflow</h2>
                <div
                  className="flex rounded-md border bg-card p-0.5 text-xs"
                  role="group"
                  aria-label="View"
                >
                  {(
                    [
                      ["board", "By stage"],
                      ["list", "List"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setView(key)}
                      aria-pressed={view === key}
                      className={`rounded px-2.5 py-1 ${view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {priority !== "All" && (
                  <button
                    className="filter-reset"
                    onClick={() => setPriority("All")}
                    aria-label="Clear priority filter"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear filter
                  </button>
                )}
                <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only sm:not-sr-only">Priority</span>
                  <select
                    aria-label="Filter priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as "All" | Priority)}
                    className="bg-transparent outline-none"
                  >
                    <option>All</option>
                    <option>Urgent</option>
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </label>
              </div>
            </div>
            {view === "list" ? (
              <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Request</th>
                      <th className="px-4 py-2 font-medium">Priority</th>
                      <th className="px-4 py-2 font-medium">Stage</th>
                      <th className="px-4 py-2 font-medium">Next to act</th>
                      <th className="px-4 py-2 font-medium">Next action</th>
                      <th className="px-4 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <Link
                            to="/requests/$id"
                            params={{ id: r.id }}
                            className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                            <span className="block font-medium">{r.title}</span>
                            <span className="block text-xs text-muted-foreground">{r.address}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded border px-2 py-0.5 text-xs ${priorityTone[r.priority]}`}
                          >
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">{r.column}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.waitingOn}</td>
                        <td className="px-4 py-3">{r.nextAction}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.lastUpdate}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                          No matching requests
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className={`home-board-grid ${view === "list" ? "hidden" : ""}`}>
              {columns.map((c) => {
                const items = filtered.filter((r) => r.column === c.name);
                return (
                  <details key={c.name} className="stage-lane" open>
                    <summary className="stage-heading">
                      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className={`ml-auto rounded px-1.5 text-xs font-medium ${c.tone}`}>
                        {items.length}
                      </span>
                    </summary>
                    <div className="stage-records">
                      {items.map((r) => (
                        <RequestCard key={r.id} r={r} />
                      ))}
                      {items.length === 0 ? (
                        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                          No matching requests
                        </div>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      {newOpen ? (
        <CreateRequest
          onClose={() => setNewOpen(false)}
          onSubmit={async (input) => {
            const item = await addRequest(input);
            setNewOpen(false);
            notify(`${item.id} created`);
            navigate({ to: "/requests/$id", params: { id: item.id } });
          }}
        />
      ) : null}
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
    >
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
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-float"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Create repair request</h2>
            <p className="text-sm text-muted-foreground">Add a new issue to the triage queue.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
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
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create request
          </button>
        </div>
      </form>
    </div>
  );
}
