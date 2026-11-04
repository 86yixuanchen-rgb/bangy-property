import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Mail, Plus, Search, Trash2, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { columns } from "@/lib/data";
import { disconnectGmail } from "@/lib/gmail.functions";
import {
  addAppointment,
  addProperty,
  deleteAppointment,
  deleteProperty,
  getAnalytics,
  getSettings,
  listAppointments,
  listContacts,
  listProperties,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/workspace/$section")({
  head: ({ params }) => ({ meta: [{ title: `${title(params.section)} — Banjg Property` }] }),
  component: WorkspaceSection,
});

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const subtitles: Record<string, string> = {
  properties: "The properties you manage and the requests raised against them.",
  contacts: "Everyone you have added to a repair request, with their emails.",
  calendar: "Appointments for repairs, inspections and access.",
  analytics: "Live numbers from your requests, emails and quotes.",
  settings: "Your account and connected services.",
};

function WorkspaceSection() {
  const { section } = Route.useParams();
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title(section)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subtitles[section] ?? "Manage your property workspace."}
          </p>
        </div>
        {section === "properties" ? (
          <PropertiesSection />
        ) : section === "contacts" ? (
          <ContactsSection />
        ) : section === "calendar" ? (
          <CalendarSection />
        ) : section === "analytics" ? (
          <AnalyticsSection />
        ) : (
          <SettingsSection />
        )}
      </div>
    </AppShell>
  );
}

const inputClass =
  "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring";

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none"
      />
    </div>
  );
}

function PropertiesSection() {
  const { requests, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["properties"],
    queryFn: () => listProperties(),
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ address: "", ownerName: "", ownerEmail: "", notes: "" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["properties"] });

  const rows = useMemo(
    () =>
      data
        .filter((p) =>
          `${p.address} ${p.ownerName} ${p.ownerEmail}`.toLowerCase().includes(query.toLowerCase()),
        )
        .map((p) => ({
          ...p,
          requests: requests.filter((r) =>
            r.address.toLowerCase().includes(p.address.toLowerCase()),
          ),
        })),
    [data, query, requests],
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Search properties…" />
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add property
        </button>
      </div>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addProperty({ data: form }).then(() => {
              setForm({ address: "", ownerName: "", ownerEmail: "", notes: "" });
              setOpen(false);
              notify("Property added");
              return refresh();
            });
          }}
          className="grid gap-3 rounded-lg border bg-card p-4 shadow-card sm:grid-cols-2"
        >
          <input
            required
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Address"
            aria-label="Address"
            className={`${inputClass} sm:col-span-2`}
          />
          <input
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
            placeholder="Owner / landlord name"
            aria-label="Owner name"
            className={inputClass}
          />
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            placeholder="Owner email"
            aria-label="Owner email"
            className={inputClass}
          />
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (access codes, tenant details…)"
            aria-label="Notes"
            className={`${inputClass} sm:col-span-2`}
          />
          <button className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground sm:col-span-2">
            Save property
          </button>
        </form>
      ) : null}
      <div className="overflow-hidden rounded-lg border bg-card shadow-card">
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : null}
        {!isLoading && rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {data.length === 0
              ? "No properties yet. Add the first one to track its requests."
              : "No properties match your search."}
          </p>
        ) : null}
        {rows.map((p) => {
          const active = p.requests.filter((r) => r.column !== "Completed");
          return (
            <div
              key={p.id}
              className="grid gap-2 border-b p-4 last:border-0 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center"
            >
              <div className="flex items-center gap-3 font-medium">
                <Building2 className="h-4 w-4 shrink-0 text-primary" />
                <span>
                  {p.address}
                  {p.notes ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {p.notes}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {p.ownerName || "No owner recorded"}
                {p.ownerEmail ? <span className="block text-xs">{p.ownerEmail}</span> : null}
              </div>
              <div className="text-sm text-muted-foreground">
                {active.length === 0 ? (
                  "No active requests"
                ) : (
                  <span className="space-x-1">
                    {active.map((r) => (
                      <Link
                        key={r.id}
                        to="/requests/$id"
                        params={{ id: r.id }}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {r.id}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
              <button
                onClick={() =>
                  void deleteProperty({ data: { id: p.id } }).then(() => {
                    notify("Property removed");
                    return refresh();
                  })
                }
                className="justify-self-end rounded p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={`Remove ${p.address}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ContactsSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listContacts(),
    staleTime: 0,
  });
  const [query, setQuery] = useState("");
  const rows = data.filter((c) =>
    `${c.name} ${c.email} ${c.roles.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder="Search contacts…" />
      <div className="overflow-hidden rounded-lg border bg-card shadow-card">
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : null}
        {!isLoading && rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {data.length === 0
              ? "No contacts yet. People you add to a repair request appear here."
              : "No contacts match your search."}
          </p>
        ) : null}
        {rows.map((c) => (
          <div
            key={c.email}
            className="grid gap-2 border-b p-4 last:border-0 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center"
          >
            <div className="flex items-center gap-3 font-medium">
              <Users className="h-4 w-4 shrink-0 text-primary" />
              <span>
                {c.name}
                <span className="block text-xs font-normal text-muted-foreground">{c.email}</span>
              </span>
            </div>
            <div className="text-sm text-muted-foreground">{c.roles.join(", ")}</div>
            <div className="space-x-1 text-sm">
              {c.requests.map((id) => (
                <Link
                  key={id}
                  to="/requests/$id"
                  params={{ id }}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {id}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              {c.emails}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CalendarSection() {
  const { requests, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => listAppointments(),
    staleTime: 0,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", when: "", location: "", requestId: "" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["appointments"] });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = startOfToday.getTime() + 24 * 3600 * 1000;
  const today = data.filter((a) => a.startsAt >= startOfToday.getTime() && a.startsAt < endOfToday);
  const upcoming = data.filter((a) => a.startsAt >= endOfToday);
  const past = data.filter((a) => a.startsAt < startOfToday.getTime()).reverse();

  const group = (label: string, items: typeof data) =>
    items.length === 0 ? null : (
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => (
            <div key={a.id} className="rounded-lg border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                <button
                  onClick={() =>
                    void deleteAppointment({ data: { id: a.id } }).then(() => {
                      notify("Appointment removed");
                      return refresh();
                    })
                  }
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label={`Remove ${a.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {new Date(a.startsAt).toLocaleString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="mt-1 font-medium">{a.title}</div>
              {a.location ? (
                <div className="text-xs text-muted-foreground">{a.location}</div>
              ) : null}
              {a.requestId ? (
                <Link
                  to="/requests/$id"
                  params={{ id: a.requestId }}
                  className="mt-2 inline-block font-mono text-xs text-primary hover:underline"
                >
                  {a.requestId}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <>
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          New appointment
        </button>
      </div>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const startsAt = new Date(form.when).getTime();
            if (!Number.isFinite(startsAt)) return;
            void addAppointment({
              data: {
                title: form.title,
                startsAt,
                location: form.location,
                requestId: form.requestId || null,
              },
            }).then(() => {
              setForm({ title: "", when: "", location: "", requestId: "" });
              setOpen(false);
              notify("Appointment booked");
              return refresh();
            });
          }}
          className="grid gap-3 rounded-lg border bg-card p-4 shadow-card sm:grid-cols-2"
        >
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title (e.g. Plumber attends)"
            aria-label="Title"
            className={`${inputClass} sm:col-span-2`}
          />
          <input
            required
            type="datetime-local"
            value={form.when}
            onChange={(e) => setForm({ ...form, when: e.target.value })}
            aria-label="Date and time"
            className={inputClass}
          />
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Location"
            aria-label="Location"
            className={inputClass}
          />
          <select
            value={form.requestId}
            onChange={(e) => setForm({ ...form, requestId: e.target.value })}
            aria-label="Related request"
            className={`${inputClass} sm:col-span-2`}
          >
            <option value="">Not linked to a request</option>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.title}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground sm:col-span-2">
            Book appointment
          </button>
        </form>
      ) : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!isLoading && data.length === 0 ? (
        <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
          Nothing booked yet. Book an appointment here or from a repair request.
        </p>
      ) : null}
      {group("Today", today)}
      {group("Upcoming", upcoming)}
      {group("Past", past)}
    </>
  );
}

function AnalyticsSection() {
  const { requests } = useWorkspace();
  const { data } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => getAnalytics(),
    staleTime: 0,
  });
  const completed = requests.filter((r) => r.column === "Completed").length;
  const cards: [string, string | number][] = [
    ["Open requests", requests.length - completed],
    ["Urgent", requests.filter((r) => r.priority === "Urgent" && r.column !== "Completed").length],
    ["Scheduled", requests.filter((r) => r.column === "Scheduled").length],
    [
      "Completion rate",
      requests.length === 0 ? "—" : `${Math.round((completed / requests.length) * 100)}%`,
    ],
    ["Emails (30 days)", data?.emails30d ?? "…"],
    ["Emails linked to requests", data?.emailsLinked ?? "…"],
    ["Contacts", data?.contacts ?? "…"],
    [
      "Approved quotes",
      data
        ? `$${data.quotesApprovedTotal.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`
        : "…",
    ],
  ];
  const priorities = ["Urgent", "High", "Medium", "Low"] as const;
  const maxStage = Math.max(
    1,
    ...columns.map((c) => requests.filter((r) => r.column === c.name).length),
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-5 shadow-card">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-3xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5 shadow-card">
          <h2 className="mb-4 font-semibold">Requests by stage</h2>
          <div className="space-y-3">
            {columns.map((c) => {
              const n = requests.filter((r) => r.column === c.name).length;
              return (
                <div
                  key={c.name}
                  className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm"
                >
                  <span>{c.name}</span>
                  <div className="h-2 rounded bg-muted">
                    <div
                      className={`h-2 rounded ${c.dot}`}
                      style={{ width: `${(n / maxStage) * 100}%` }}
                    />
                  </div>
                  <span className="text-right text-muted-foreground">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-card">
          <h2 className="mb-4 font-semibold">Open requests by priority</h2>
          <div className="space-y-3">
            {priorities.map((p) => {
              const n = requests.filter((r) => r.priority === p && r.column !== "Completed").length;
              const open = Math.max(1, requests.length - completed);
              return (
                <div key={p} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm">
                  <span>{p}</span>
                  <div className="h-2 rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary"
                      style={{ width: `${(n / open) * 100}%` }}
                    />
                  </div>
                  <span className="text-right text-muted-foreground">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const comingSoon = [
  ["Instagram", "Meta messaging"],
  ["WhatsApp Business", "Tenant and trade messaging"],
  ["Microsoft Teams", "Internal collaboration"],
  ["Slack", "Internal collaboration"],
  ["PropertyMe / Property Tree", "Property management"],
  ["AppFolio / Buildium", "Property management"],
];

function SettingsSection() {
  const { user } = useAuth();
  const { notify } = useWorkspace();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => getSettings(), staleTime: 0 });
  const row = "flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4 shadow-card";
  const badge = (ok: boolean, yes: string, no: string) => (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? "bg-done-soft text-done" : "bg-muted text-muted-foreground"}`}
    >
      {ok ? yes : no}
    </span>
  );
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Account</h2>
        <div className={row}>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{user?.name}</div>
            <div className="text-xs text-muted-foreground">{user?.email}</div>
          </div>
          {badge(true, "Signed in", "")}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Connected services</h2>
        <div className={row}>
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary-soft text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Gmail</div>
            <div className="text-xs text-muted-foreground">
              {data?.gmail
                ? `${data.gmail.email}${data.gmail.lastSyncAt ? ` · last synced ${new Date(data.gmail.lastSyncAt).toLocaleString()}` : ""}`
                : data && !data.googleConfigured
                  ? "Google credentials are not configured on this server"
                  : "Read and send email from your repair requests"}
            </div>
          </div>
          {data?.gmail ? (
            <button
              onClick={() =>
                void disconnectGmail().then(() => {
                  notify("Gmail disconnected");
                  return queryClient.invalidateQueries();
                })
              }
              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              Disconnect
            </button>
          ) : (
            <a
              href="/api/gmail/connect"
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
            >
              Connect
            </a>
          )}
        </div>
        <div className={row}>
          <div className="min-w-0 flex-1">
            <div className="font-medium">DeepSeek AI</div>
            <div className="text-xs text-muted-foreground">
              Summaries, next steps and the assistant
            </div>
          </div>
          {badge(Boolean(data?.aiConfigured), "Configured", "API key missing")}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Not available yet</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {comingSoon.map(([name, description]) => (
            <div key={name} className={`${row} opacity-70`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </div>
              {badge(false, "", "Coming soon")}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
