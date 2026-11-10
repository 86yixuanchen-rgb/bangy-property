import { AppointmentAlternatives } from "@/components/AssistantExtras";
import { ReviewCenter } from "@/components/ReviewCenter";
import { ContactsDirectory } from "@/components/ContactsDirectory";
import { RescheduleButton } from "@/components/case-workflow/CaseWorkflow";
import { CancelVisit } from "@/components/case-workflow/Management";
import { PropertiesSection } from "@/components/PropertiesSection";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Mail, Plus, Search, Trash2, Users } from "lucide-react";
import { PropertySelect } from "@/components/PropertySelect";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { columns } from "@/lib/data";
import { disconnectGmail } from "@/lib/gmail.functions";
import {
  addAppointment,
  getAnalytics,
  getSettings,
  listAppointments,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/workspace/$section")({
  head: ({ params }) => ({ meta: [{ title: `${title(params.section)} — Banjg Property` }] }),
  validateSearch: (search: Record<string, unknown>): { property?: number } =>
    Number(search["property"]) > 0 ? { property: Number(search["property"]) } : {},
  component: WorkspaceSection,
});

function title(value: string) {
  if (value === "review") return "Review center";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const subtitles: Record<string, string> = {
  review: "Review pending work and continue where you left off.",
  properties: "Your properties, their PMs, landlords and tenants, and all related events.",
  contacts: "People linked to your properties and events, with their roles and emails.",
  calendar: "Appointments for repairs, inspections and access.",
  analytics: "Live numbers from your requests, emails and quotes.",
  settings: "Your account and connected services.",
};

function WorkspaceSection() {
  const { section } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedAppointment, setSelectedAppointment] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [assistantSignal, setAssistantSignal] = useState(0);
  return (
    <AppShell
      openAssistantSignal={assistantSignal}
      assistantContext={
        selectedAppointment
          ? { appointmentId: selectedAppointment.id }
          : search.property
            ? { propertyId: search.property }
            : undefined
      }
      assistantContextLabel={
        selectedAppointment
          ? `Appointment: ${selectedAppointment.title}`
          : search.property
            ? `Selected property #${search.property}`
            : undefined
      }
    >
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title(section)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {subtitles[section] ?? "Manage your property workspace."}
          </p>
        </div>
        {section === "review" ? (
          <ReviewCenter />
        ) : section === "properties" ? (
          <PropertiesSection
            selectedPropertyId={search.property ?? null}
            onSelectProperty={(property) => {
              void navigate({ search: property ? { property } : {} });
            }}
          />
        ) : section === "contacts" ? (
          <ContactsDirectory />
        ) : section === "calendar" ? (
          <CalendarSection
            onAsk={(appointment) => {
              setSelectedAppointment(appointment);
              setAssistantSignal((s) => s + 1);
            }}
          />
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

function CalendarSection({ onAsk }: { onAsk: (a: { id: number; title: string }) => void }) {
  const { requests, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => listAppointments(),
    staleTime: 0,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    when: "",
    duration: "60",
    attendees: "",
    location: "",
    requestId: "",
    propertyId: "",
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["appointments"] });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = startOfToday.getTime() + 24 * 3600 * 1000;
  const today = data.filter(
    (a) => !a.cancelledAt && a.startsAt >= startOfToday.getTime() && a.startsAt < endOfToday,
  );
  const upcoming = data.filter((a) => !a.cancelledAt && a.startsAt >= endOfToday);
  const past = data.filter((a) => !a.cancelledAt && a.startsAt < startOfToday.getTime()).reverse();

  const group = (label: string, items: typeof data) =>
    items.length === 0 ? null : (
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => (
            <div key={a.id} className="rounded-lg border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                <div className="flex gap-2">
                  {!a.cancelledAt ? (
                    <RescheduleButton appointment={a} requestId={a.requestId ?? ""} />
                  ) : null}
                  <CancelVisit appointment={a} onChanged={refresh} />
                </div>
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
              <div className="text-xs text-muted-foreground">
                {Math.round(((a.endsAt ?? a.startsAt + 3600000) - a.startsAt) / 60000)} minutes ·{" "}
                {JSON.parse(a.attendeeEmails).length} attendees
              </div>
              <div className="mt-1 font-medium">{a.title}</div>
              <button className="mt-2 text-xs text-primary" onClick={() => onAsk(a)}>
                Ask AI about this appointment
              </button>
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
                endsAt: startsAt + Number(form.duration) * 60000,
                attendeeEmails: form.attendees
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                location: form.location,
                requestId: form.requestId || null,
                propertyId: Number(form.propertyId),
              },
            })
              .then(() => {
                setForm({
                  title: "",
                  when: "",
                  duration: "60",
                  attendees: "",
                  location: "",
                  requestId: "",
                  propertyId: "",
                });
                setOpen(false);
                notify("Appointment booked");
                return refresh();
              })
              .catch((error: unknown) =>
                notify(error instanceof Error ? error.message : "Could not book this appointment."),
              );
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
          <label className="text-xs">
            Duration (minutes)
            <input
              aria-label="Duration in minutes"
              type="number"
              min="15"
              max="1440"
              step="15"
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="text-xs">
            Attendee emails
            <input
              aria-label="Attendee emails"
              value={form.attendees}
              onChange={(e) => setForm({ ...form, attendees: e.target.value })}
              className={inputClass}
              placeholder="Separate with commas"
            />
          </label>
          <div className="sm:col-span-2">
            <PropertySelect
              value={form.propertyId}
              onChange={(value) => setForm({ ...form, propertyId: value, requestId: "" })}
            />
          </div>
          <select
            value={form.requestId}
            onChange={(e) => setForm({ ...form, requestId: e.target.value })}
            aria-label="Related request"
            className={`${inputClass} sm:col-span-2`}
          >
            <option value="">Property appointment (no repair event)</option>
            {requests
              .filter((r) => r.propertyId === Number(form.propertyId))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.title}
                </option>
              ))}
          </select>
          <div className="sm:col-span-2">
            <AppointmentAlternatives
              action="appointment.create"
              args={{
                propertyId: Number(form.propertyId),
                startsAt: new Date(form.when).getTime(),
                endsAt: new Date(form.when).getTime() + Number(form.duration) * 60000,
                attendeeEmails: form.attendees
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }}
              onSelect={(args) => {
                const d = new Date(Number(args["startsAt"]));
                const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16);
                setForm((f) => ({ ...f, when: local }));
              }}
            />
          </div>
          <button
            disabled={!form.propertyId}
            className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:col-span-2"
          >
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
      {group(
        "Cancelled",
        data.filter((a) => a.cancelledAt),
      )}
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
