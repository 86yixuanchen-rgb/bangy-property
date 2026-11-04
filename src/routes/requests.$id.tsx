import { useDiscardGuard } from "@/hooks/use-discard-guard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Bell,
  FileText,
  ChevronLeft,
  Hourglass,
  X,
  Plus,
  Check,
  Sparkles,
  Send,
  StickyNote,
  RefreshCw,
  Link2,
  Trash2,
  Flag,
  CalendarDays,
} from "lucide-react";
import {
  FormDialog,
  ErrorState,
  LoadingRows,
  StatusLabel,
  PendingLabel,
} from "@/components/workspace-ui";
import { useAsyncAction } from "@/hooks/use-ui-state";
import { AppShell } from "@/components/AppShell";
import { columns, priorityTone, type Column } from "@/lib/data";
import { columnStatus, useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import {
  addNote,
  addParticipant,
  analyzeIncident,
  getIncident,
  linkEmail,
  removeParticipant,
  type IncidentEmail,
} from "@/lib/incidents.functions";
import { participantRoles } from "@/db/schema";
import { sendEmail } from "@/lib/send-email";
import {
  addAppointment,
  addQuote,
  decideQuote,
  deleteAppointment,
} from "@/lib/workspace.functions";

export const Route = createFileRoute("/requests/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.id} — RepairFlow` },
      {
        name: "description",
        content: `Status, next action and full activity timeline for ${params.id}.`,
      },
      { property: "og:title", content: `${params.id} — RepairFlow` },
      {
        property: "og:description",
        content: "Repair request detail with unified communication timeline.",
      },
    ],
  }),
  component: Detail,
});

type Role = (typeof participantRoles)[number];
type Entry = {
  key: string;
  at: number;
  kind: "email-in" | "email-out" | "status" | "note" | "created" | "quote" | "appointment";
  who: string;
  role: string;
  title: string;
  body?: string;
  counterpart?: { name: string; email: string } | undefined;
};

const roleTone: Record<string, string> = {
  Tenant: "bg-primary-soft text-primary",
  Landlord: "bg-waiting-soft text-waiting",
  "Repair Team": "bg-done-soft text-done",
  "Property Manager": "bg-muted text-muted-foreground",
};

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatWhen = (at: number) =>
  new Date(at).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

function firstAddress(list: string) {
  return list.split(",")[0]?.trim() ?? "";
}

function emailEntry(m: IncidentEmail, roleOf: Map<string, string>): Entry {
  const other = m.outgoing ? firstAddress(m.toEmails) : m.fromEmail;
  return {
    key: `mail-${m.id}`,
    at: m.receivedAt,
    kind: m.outgoing ? "email-out" : "email-in",
    who: m.outgoing ? "You" : m.fromName,
    role: m.outgoing ? "Property Manager" : (roleOf.get(m.fromEmail) ?? "Unassigned"),
    title: m.subject,
    body: m.body,
    counterpart: other ? { name: m.outgoing ? other : m.fromName, email: other } : undefined,
  };
}

function Detail() {
  const { id } = Route.useParams();
  const { requests, loaded, loadError, retryRequests, updateRequest, notify } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useAsyncAction();
  const [actionContext, setActionContext] = useState("");
  const perform = (context: string, task: () => Promise<void>, message: string) => {
    setActionContext(context);
    return mutation.run(task, message);
  };
  const [mailError, setMailError] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminder, setReminder] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [quoteForm, setQuoteForm] = useState({ supplier: "", amount: "", description: "" });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [apptForm, setApptForm] = useState({ title: "", when: "", location: "" });
  const [apptOpen, setApptOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<{ role: Role; name: string; email: string }>({
    role: "Tenant",
    name: "",
    email: "",
  });

  const dirty = Boolean(
    quoteForm.supplier ||
    quoteForm.amount ||
    quoteForm.description ||
    apptForm.title ||
    apptForm.when ||
    apptForm.location ||
    person.name ||
    person.email ||
    note ||
    (reminderOpen && (reminder.to || reminder.subject || reminder.body)),
  );
  const edits = useDiscardGuard(dirty, mutation.pending);
  const r = requests.find((x) => x.id === id);
  const incident = useQuery({
    queryKey: ["incident", id],
    queryFn: () => getIncident({ data: { id } }),
    staleTime: 0,
  });
  const d = incident.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["incident", id] });

  const analyze = async () => {
    setAnalyzing(true);
    setAiError("");
    try {
      const result = await analyzeIncident({ data: { id } });
      if (!result.ok) {
        setAiError(
          result.code === "NOT_CONFIGURED"
            ? "DeepSeek is not configured for this environment."
            : "The AI could not analyse this request right now.",
        );
      }
      await refresh();
    } catch {
      setAiError("The AI could not analyse this request right now.");
    } finally {
      setAnalyzing(false);
    }
  };

  const attempted = useRef("");
  useEffect(() => {
    if (!d || !r || d.emails.length === 0) return;
    const newest = Math.max(...d.emails.map((e) => e.receivedAt), ...d.events.map((e) => e.at));
    const key = `${id}:${newest}`;
    if ((!d.ai || newest > d.ai.updatedAt) && attempted.current !== key) {
      attempted.current = key;
      void analyze();
    }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded || loadError)
    return (
      <AppShell>
        <div className="repair-detail">
          {loadError ? (
            <ErrorState message="Could not load this repair." retry={retryRequests} />
          ) : (
            <LoadingRows label="Loading repair details" />
          )}
        </div>
        {edits.confirmation}
      </AppShell>
    );
  if (!r) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="font-mono text-sm text-muted-foreground">{id}</div>
          <h1 className="text-xl font-semibold">Request not found</h1>
          <p className="text-sm text-muted-foreground">
            This repair request doesn't exist or may have been removed.
          </p>
          <Link to="/" className="text-sm font-medium text-primary hover:underline">
            Back to Home
          </Link>
        </div>
      </AppShell>
    );
  }

  const stepIndex = columns.findIndex((c) => c.name === r.column);

  const participants = d?.participants ?? [];
  const roleOf = new Map(participants.map((p) => [p.email.toLowerCase(), p.role as string]));
  const entries: Entry[] = [
    ...(d?.events ?? []).map<Entry>((e) => ({
      key: `ev-${e.id}`,
      at: e.at,
      kind: e.kind,
      who: e.actor,
      role: "Property Manager",
      title: e.text,
    })),
    ...(d?.emails ?? []).map((m) => emailEntry(m, roleOf)),
  ].sort((a, b) => a.at - b.at);

  const countFor = (email: string) =>
    (d?.emails ?? []).filter((m) => m.fromEmail === email || m.toEmails.split(",").includes(email))
      .length;

  const persistColumn = async (column: Column, extra: Partial<typeof r> = {}) => {
    await updateRequest(r.id, {
      column,
      status: columnStatus[column],
      lastUpdate: "Just now",
      ...extra,
    });
    await refresh();
  };
  const changeColumn = (column: Column, extra: Partial<typeof r> = {}, context = "status") => {
    return perform(
      context,
      () => persistColumn(column, extra),
      "Could not confirm this update. Refresh the repair before trying again.",
    );
  };
  const submitPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform(
      "person",
      async () => {
        await addParticipant({ data: { requestId: r.id, ...person } });
        setPerson({ role: person.role, name: "", email: "" });
        setAdding(false);
        await refresh();
        notify("Person added and matching emails linked");
      },
      "Could not add this person. Check the email and try again; your entries have been kept.",
    );
  };
  const addSender = (role: Role, name: string, email: string) =>
    perform(
      "person",
      async () => {
        await addParticipant({ data: { requestId: r.id, role, name, email } });
        await refresh();
        notify(`${name} added as ${role}`);
      },
      "Could not add this person. Please try again.",
    );

  const openReminder = () => {
    const waiting = r.waitingOn.toLowerCase();
    const target =
      participants.find((p) => waiting.includes(p.name.toLowerCase())) ??
      participants.find((p) => waiting.includes(p.role.toLowerCase())) ??
      participants[0];
    const first = target?.name.split(" ")[0] ?? "there";
    setReminder({
      to: target?.email ?? "",
      subject: `Follow-up: ${r.title} (${r.id})`,
      body: `Hi ${first},\n\nA quick follow-up on the repair request "${r.title}" at ${r.address}.\n\nNext step: ${r.nextAction}\n\nCould you please let me know where this is up to?\n\nThanks,\n${user?.name ?? ""}`,
    });
    setReminderOpen(true);
  };

  const submitReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform(
      "email",
      async () => {
        setSending(true);
        setMailError("");
        try {
          const result = await sendEmail({ data: { ...reminder, requestId: r.id } });
          if (!result.ok) {
            setMailError(
              result.code === "UNCERTAIN"
                ? "Delivery is not confirmed. Check Gmail Sent. Retrying this draft safely checks the result; do not create a replacement message."
                : result.code === "RECONNECT"
                  ? "Reconnect Gmail in the Inbox before sending. Your draft has been kept."
                  : "The email could not be sent. Your draft has been kept; please try again.",
            );
            throw new Error("Send not confirmed");
          }
          setReminderOpen(false);
          setReminder({ to: "", subject: "", body: "" });
          await refresh();
          notify(`Email sent to ${reminder.to}`);
        } finally {
          setSending(false);
        }
      },
      "Email delivery was not confirmed. Review the message in the email dialog before retrying.",
    );
  };
  const submitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(quoteForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await perform(
      "quote",
      async () => {
        await addQuote({
          data: {
            requestId: r.id,
            supplier: quoteForm.supplier,
            amount,
            description: quoteForm.description,
          },
        });
        setQuoteForm({ supplier: "", amount: "", description: "" });
        setQuoteOpen(false);
        await refresh();
        notify("Quote recorded");
      },
      "Could not confirm the quote was recorded. Your entries remain; refresh the repair before retrying.",
    );
  };
  const decide = (id: number, decision: "Approved" | "Rejected") => {
    return perform(
      "decision",
      async () => {
        const result = await decideQuote({ data: { id, decision } });
        if (!result.ok) throw new Error("Decision not confirmed");
        if (decision === "Approved")
          await persistColumn("Scheduled", { status: "Ready to schedule" });
        await refresh();
        notify(`Quote ${decision.toLowerCase()}`);
      },
      "Could not confirm the full quote update. Refresh to check its current approval status before retrying.",
    );
  };
  const submitAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    const startsAt = new Date(apptForm.when).getTime();
    if (!Number.isFinite(startsAt)) return;
    await perform(
      "appointment",
      async () => {
        await addAppointment({
          data: { title: apptForm.title, startsAt, location: apptForm.location, requestId: r.id },
        });
        setApptForm({ title: "", when: "", location: "" });
        setApptOpen(false);
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        ]);
        notify("Appointment booked");
      },
      "Could not confirm the appointment was booked. Your entries remain; refresh before retrying.",
    );
  };
  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await perform(
      "note",
      async () => {
        await addNote({ data: { requestId: r.id, text: note.trim() } });
        await refresh();
        setNote("");
        setNoteOpen(false);
        notify("Timeline note added");
      },
      "Could not save your note. It has been kept in the note dialog. Please try again.",
    );
  };

  return (
    <AppShell>
      <div className="repair-detail mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        {mutation.error &&
          !(
            (actionContext === "quote" && quoteOpen) ||
            (actionContext === "appointment" && apptOpen) ||
            (actionContext === "person" && adding) ||
            (actionContext === "email" && reminderOpen) ||
            (actionContext === "note" && noteOpen) ||
            actionContext === "ai" ||
            actionContext === "decision"
          ) && (
            <ErrorState
              message={mutation.error}
              retry={() => {
                retryRequests();
                void refresh();
              }}
            />
          )}
        {mutation.pending && (
          <div className="mutation-status" role="status">
            <PendingLabel>Saving changes…</PendingLabel>
          </div>
        )}
        {incident.isError && (
          <ErrorState
            message="Could not load the communication and repair context."
            retry={() => void incident.refetch()}
          />
        )}
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-sm text-muted-foreground">{r.id}</div>
            <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
            <p className="text-muted-foreground">{r.address}</p>
          </div>
          <span className={`rounded border px-2 py-0.5 text-xs ${priorityTone[r.priority]}`}>
            {r.priority} priority
          </span>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-card">
          <ol className="flex items-start" aria-label="Request progress">
            {columns.map((c, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={c.name} className="relative flex flex-1 flex-col items-center text-center">
                  {i > 0 ? (
                    <span
                      className={`absolute left-[-50%] top-3 h-0.5 w-full ${i <= stepIndex ? "bg-primary" : "bg-border"}`}
                    />
                  ) : null}
                  <button
                    disabled={mutation.pending}
                    onClick={async () => {
                      if (!current && (await changeColumn(c.name)))
                        notify(`${r.id} moved to ${c.name}`);
                    }}
                    aria-current={current ? "step" : undefined}
                    title={`Move to ${c.name}`}
                    className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-semibold ${
                      current
                        ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </button>
                  <span
                    className={`mt-1.5 text-[11px] ${current ? "font-semibold text-primary" : "text-muted-foreground"}`}
                  >
                    {c.name}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-waiting">
              <Hourglass className="h-3.5 w-3.5" />
              {r.status}
            </span>
            <span className="text-muted-foreground">
              Waiting on <span className="font-medium text-foreground">{r.waitingOn}</span>
            </span>
            <span className="text-muted-foreground">Updated {r.lastUpdate}</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="detail-main space-y-6 lg:col-span-2">
            <div className="confirmed-action rounded-lg border bg-primary-soft p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                Current next action
              </div>
              <div className="mt-1 text-lg font-semibold">{r.nextAction}</div>
              <div className="text-sm text-muted-foreground">Waiting on {r.waitingOn}</div>
              <div className="mt-4 flex gap-2">
                <button
                  disabled={mutation.pending}
                  onClick={openReminder}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  <Bell className="h-4 w-4" />
                  Send Reminder
                </button>
              </div>
            </div>
            <div className="communication-ledger rounded-lg border bg-card p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Activity timeline</h2>
                <button
                  disabled={mutation.pending}
                  onClick={() => setNoteOpen(true)}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add note
                </button>
              </div>
              {incident.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading activity…</p>
              ) : (
                <ol className="relative space-y-5 border-l pl-6">
                  {entries.length === 0 ? (
                    <li className="text-sm text-muted-foreground">
                      No activity yet.{" "}
                      {d?.gmailConnected
                        ? "Add the people involved and their emails will appear here."
                        : "Connect Gmail in the Unified Inbox and add the people involved to see their emails here."}
                    </li>
                  ) : null}
                  {entries.map((t) => {
                    const isMail = t.kind === "email-in" || t.kind === "email-out";
                    const open = expanded === t.key;
                    return (
                      <li key={t.key} className="relative">
                        <span
                          className={`absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full border bg-card ${
                            t.kind === "status" ? "border-primary" : ""
                          }`}
                        >
                          {t.kind === "email-out" ? (
                            <Send className="h-3 w-3 text-primary" />
                          ) : isMail ? (
                            <Mail className="h-3 w-3 text-primary" />
                          ) : t.kind === "note" ? (
                            <StickyNote className="h-3 w-3 text-done" />
                          ) : t.kind === "quote" ? (
                            <FileText className="h-3 w-3 text-primary" />
                          ) : t.kind === "appointment" ? (
                            <CalendarDays className="h-3 w-3 text-primary" />
                          ) : (
                            <Flag className="h-3 w-3 text-primary" />
                          )}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatWhen(t.at)}</span>
                          <span>·</span>
                          <span>{t.who}</span>
                          {isMail || t.kind === "note" ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleTone[t.role] ?? "bg-muted text-muted-foreground"}`}
                            >
                              {t.kind === "note" ? "Internal note" : t.role}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm font-medium">
                          {isMail ? (t.kind === "email-out" ? "Sent: " : "") : ""}
                          {t.title}
                        </div>
                        {isMail ? (
                          <>
                            <button
                              disabled={mutation.pending}
                              onClick={() => setExpanded(open ? null : t.key)}
                              className="mt-1 text-xs text-primary hover:underline"
                            >
                              {open ? "Hide email" : "Read email"}
                            </button>
                            {open ? (
                              <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
                                {t.body}
                              </p>
                            ) : null}
                            {t.role === "Unassigned" && t.counterpart ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                Add {t.counterpart.email} as
                                {participantRoles.map((role) => (
                                  <button
                                    disabled={mutation.pending}
                                    key={role}
                                    onClick={() =>
                                      void addSender(
                                        role,
                                        t.counterpart?.name ?? "",
                                        t.counterpart?.email ?? "",
                                      )
                                    }
                                    className="rounded border px-1.5 py-0.5 hover:bg-muted"
                                  >
                                    {role}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                  <li className="relative">
                    <span className="absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full bg-waiting">
                      <Hourglass className="h-3 w-3 text-primary-foreground" />
                    </span>
                    <div className="text-xs text-muted-foreground">Current state</div>
                    <div className="text-sm font-semibold text-waiting">{r.status}</div>
                  </li>
                </ol>
              )}
            </div>
          </div>

          <div className="detail-support space-y-6">
            <section className="context-summary">
              <h2>Repair context</h2>
              <dl>
                <div>
                  <dt>Next to act</dt>
                  <dd>{r.waitingOn || "Unassigned"}</dd>
                </div>
                <div>
                  <dt>Assigned property manager</dt>
                  <dd>Not separately recorded</dd>
                </div>
                <div>
                  <dt>Viewing account</dt>
                  <dd>{user?.name ?? "You"}</dd>
                </div>
                <div>
                  <dt>Current status</dt>
                  <dd>
                    <StatusLabel status={r.column} />
                    <span className="block mt-1">{r.status}</span>
                  </dd>
                </div>
                <div>
                  <dt>Last update</dt>
                  <dd>{r.lastUpdate}</dd>
                </div>
              </dl>
            </section>
            <div className="ai-review rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ai">
                  <Sparkles className="h-4 w-4" />
                  AI suggested next step
                </div>
                <button
                  onClick={() => void analyze()}
                  disabled={analyzing || mutation.pending}
                  className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
                >
                  <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
                  {analyzing ? "Analysing…" : d?.ai ? "Regenerate" : "Generate"}
                </button>
              </div>
              {d?.ai ? (
                <>
                  <p className="mt-3 text-sm text-muted-foreground">{d.ai.summary}</p>
                  <div className="mt-3 text-lg font-semibold">{d.ai.nextStep}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Waiting on {d.ai.waitingOn} · suggested column: {d.ai.column}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      disabled={mutation.pending}
                      onClick={async () => {
                        const column = (columns.find((c) => c.name === d.ai?.column)?.name ??
                          r.column) as Column;
                        const saved = await changeColumn(
                          column,
                          {
                            nextAction: d.ai?.nextStep ?? r.nextAction,
                            waitingOn: d.ai?.waitingOn ?? r.waitingOn,
                          },
                          "ai",
                        );
                        if (saved) notify("AI suggestion applied to the request");
                      }}
                      className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      <Check className="h-4 w-4" />
                      {mutation.pending ? "Saving…" : "Approve suggested next action"}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Generated {formatWhen(d.ai.updatedAt)}. Nothing changes until you apply it.
                    </span>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {analyzing
                    ? "Reading the emails and activity for this request…"
                    : d && d.emails.length === 0
                      ? "No emails are linked yet. Add the tenant, landlord and repair team below so their emails appear here, then the AI will suggest what to do next."
                      : "Generate a summary and a recommended next step."}
                </p>
              )}
              {actionContext === "ai" && mutation.error && <ErrorState message={mutation.error} />}
              {aiError ? <p className="mt-2 text-xs text-destructive">{aiError}</p> : null}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">People involved</h2>
                <button
                  disabled={mutation.pending}
                  onClick={() => setAdding((v) => !v)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
              {adding ? (
                <form
                  onSubmit={(e) => void submitPerson(e)}
                  className="space-y-2 rounded-lg border bg-card p-3 shadow-card"
                >
                  <select
                    disabled={mutation.pending}
                    value={person.role}
                    onChange={(e) => setPerson({ ...person, role: e.target.value as Role })}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    aria-label="Role"
                  >
                    {participantRoles.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                  <input
                    disabled={mutation.pending}
                    required
                    value={person.name}
                    onChange={(e) => setPerson({ ...person, name: e.target.value })}
                    placeholder="Name"
                    aria-label="Name"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <input
                    disabled={mutation.pending}
                    required
                    type="email"
                    value={person.email}
                    onChange={(e) => setPerson({ ...person, email: e.target.value })}
                    placeholder="email@example.com"
                    aria-label="Email"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  {actionContext === "person" && mutation.error && (
                    <ErrorState message={mutation.error} />
                  )}
                  <button
                    disabled={mutation.pending}
                    className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground"
                  >
                    {mutation.pending && actionContext === "person"
                      ? "Saving person…"
                      : "Add person"}
                  </button>
                </form>
              ) : null}
              {participantRoles.map((role) => {
                const people = participants.filter((p) => p.role === role);
                return (
                  <div key={role} className="rounded-lg border bg-card p-4 shadow-card">
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleTone[role]}`}
                      >
                        {role}
                      </span>
                      {r.waitingOn.toLowerCase().includes(role.toLowerCase()) ? (
                        <span className="rounded bg-waiting-soft px-1.5 text-[10px] font-medium text-waiting">
                          Waiting on
                        </span>
                      ) : null}
                    </div>
                    {people.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">Nobody added yet.</p>
                    ) : null}
                    {people.map((p) => (
                      <div key={p.email} className="mt-2 flex items-center gap-3">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                          {initials(p.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.email} · {countFor(p.email)} emails
                          </div>
                        </div>
                        <button
                          disabled={mutation.pending}
                          onClick={() =>
                            void perform(
                              "general",
                              async () => {
                                await removeParticipant({
                                  data: { requestId: r.id, email: p.email },
                                });
                                await refresh();
                                notify("Person removed");
                              },
                              "Could not remove this person. Please refresh and try again.",
                            )
                          }
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          aria-label={`Remove ${p.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="rounded-lg border bg-card p-4 shadow-card">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleTone["Property Manager"]}`}
                >
                  Your account
                </span>
                <div className="mt-2 flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-semibold">
                    {initials(user?.name ?? "?")}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user?.name ?? "You"}</div>
                    <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                  </div>
                </div>
              </div>
            </div>

            {d?.gmailConnected && d.unlinkedEmails.length > 0 ? (
              <div className="space-y-2">
                <h2 className="flex items-center gap-1.5 font-semibold">
                  <Link2 className="h-4 w-4" />
                  Link an existing email
                </h2>
                {d.unlinkedEmails.map((m) => (
                  <div key={m.id} className="rounded-lg border bg-card p-3 text-sm shadow-card">
                    <div className="truncate font-medium">{m.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.outgoing ? `To ${m.toEmails}` : `From ${m.fromName}`} ·{" "}
                      {formatWhen(m.receivedAt)}
                    </div>
                    <button
                      disabled={mutation.pending}
                      onClick={() =>
                        void perform(
                          "general",
                          async () => {
                            await linkEmail({ data: { emailId: m.id, requestId: r.id } });
                            await refresh();
                            notify("Email linked to this request");
                          },
                          "Could not link this email. Please try again.",
                        )
                      }
                      className="mt-2 rounded border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Link to {r.id}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <FileText className="h-4 w-4" />
                  Quotes
                </h2>
                <button
                  disabled={mutation.pending}
                  onClick={() => setQuoteOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add quote
                </button>
              </div>
              {quoteOpen ? (
                <form
                  onSubmit={(e) => void submitQuote(e)}
                  className="mb-4 grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-[1fr_8rem]"
                >
                  <input
                    disabled={mutation.pending}
                    required
                    value={quoteForm.supplier}
                    onChange={(e) => setQuoteForm({ ...quoteForm, supplier: e.target.value })}
                    placeholder="Supplier"
                    aria-label="Supplier"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <input
                    disabled={mutation.pending}
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={quoteForm.amount}
                    onChange={(e) => setQuoteForm({ ...quoteForm, amount: e.target.value })}
                    placeholder="Amount ($)"
                    aria-label="Amount"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <input
                    disabled={mutation.pending}
                    value={quoteForm.description}
                    onChange={(e) => setQuoteForm({ ...quoteForm, description: e.target.value })}
                    placeholder="What the quote covers (optional)"
                    aria-label="Description"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring sm:col-span-2"
                  />
                  {actionContext === "quote" && mutation.error && (
                    <ErrorState message={mutation.error} />
                  )}
                  <button
                    disabled={mutation.pending}
                    className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground sm:col-span-2"
                  >
                    {mutation.pending && actionContext === "quote" ? "Saving quote…" : "Save quote"}
                  </button>
                </form>
              ) : null}
              {actionContext === "decision" && mutation.error && (
                <ErrorState message={mutation.error} />
              )}
              {actionContext === "decision" && mutation.pending && (
                <PendingLabel>Saving quote decision…</PendingLabel>
              )}
              {(d?.quotes ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No quotes recorded yet.</p>
              ) : null}
              <div className="space-y-2">
                {(d?.quotes ?? []).map((q) => (
                  <div
                    key={q.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {q.supplier} · ${q.amount.toFixed(2)}
                      </div>
                      {q.description ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {q.description}
                        </div>
                      ) : null}
                    </div>
                    {q.status === "Pending" ? (
                      <div className="flex gap-2">
                        <button
                          disabled={mutation.pending}
                          onClick={() => void decide(q.id, "Approved")}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        >
                          Approve
                        </button>
                        <button
                          disabled={mutation.pending}
                          onClick={() => void decide(q.id, "Rejected")}
                          className="rounded-md border px-3 py-1.5 text-xs"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${q.status === "Approved" ? "bg-done-soft text-done" : "bg-muted text-muted-foreground"}`}
                      >
                        {q.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  Appointments
                </h2>
                <button
                  disabled={mutation.pending}
                  onClick={() => setApptOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Book
                </button>
              </div>
              {apptOpen ? (
                <form
                  onSubmit={(e) => void submitAppointment(e)}
                  className="mb-4 grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-2"
                >
                  <input
                    disabled={mutation.pending}
                    required
                    value={apptForm.title}
                    onChange={(e) => setApptForm({ ...apptForm, title: e.target.value })}
                    placeholder="e.g. Plumber attends"
                    aria-label="Title"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring sm:col-span-2"
                  />
                  <input
                    disabled={mutation.pending}
                    required
                    type="datetime-local"
                    value={apptForm.when}
                    onChange={(e) => setApptForm({ ...apptForm, when: e.target.value })}
                    aria-label="Date and time"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <input
                    disabled={mutation.pending}
                    value={apptForm.location}
                    onChange={(e) => setApptForm({ ...apptForm, location: e.target.value })}
                    placeholder={r.address}
                    aria-label="Location"
                    className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  {actionContext === "appointment" && mutation.error && (
                    <ErrorState message={mutation.error} />
                  )}
                  <button
                    disabled={mutation.pending}
                    className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground sm:col-span-2"
                  >
                    {mutation.pending && actionContext === "appointment"
                      ? "Booking…"
                      : "Book appointment"}
                  </button>
                </form>
              ) : null}
              {(d?.appointments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
              ) : null}
              <div className="space-y-2">
                {(d?.appointments ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatWhen(a.startsAt)}
                        {a.location ? ` · ${a.location}` : ""}
                      </div>
                    </div>
                    <button
                      disabled={mutation.pending}
                      onClick={() =>
                        void perform(
                          "general",
                          async () => {
                            await deleteAppointment({ data: { id: a.id } });
                            await Promise.all([
                              refresh(),
                              queryClient.invalidateQueries({ queryKey: ["appointments"] }),
                            ]);
                            notify("Appointment cancelled");
                          },
                          "Could not confirm the appointment was cancelled. Refresh before retrying.",
                        )
                      }
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                      aria-label={`Cancel ${a.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {edits.confirmation}
      {reminderOpen ? (
        <FormDialog
          title="Send email"
          description="Review the recipient and message before sending from your connected Gmail account."
          guardNavigation={false}
          dirty={Boolean(reminder.to || reminder.subject || reminder.body)}
          busy={mutation.pending}
          onClose={() => {
            setReminderOpen(false);
            setReminder({ to: "", subject: "", body: "" });
            setMailError("");
            mutation.clearError();
          }}
        >
          {({ close }) => (
            <form onSubmit={(e) => void submitReminder(e)} className="form-stack">
              {!d?.gmailConnected ? (
                <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  Gmail is not connected yet.{" "}
                  <Link to="/inbox" className="font-medium text-primary">
                    Connect it in the Inbox
                  </Link>{" "}
                  to send emails from here.
                </p>
              ) : null}
              <div className="mt-4 space-y-3">
                <input
                  disabled={mutation.pending}
                  required
                  type="email"
                  list="people-emails"
                  value={reminder.to}
                  onChange={(e) => setReminder({ ...reminder, to: e.target.value })}
                  placeholder="To"
                  aria-label="To"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                />
                <datalist id="people-emails">
                  {participants.map((p) => (
                    <option key={p.email} value={p.email}>
                      {p.name} · {p.role}
                    </option>
                  ))}
                </datalist>
                <input
                  disabled={mutation.pending}
                  required
                  value={reminder.subject}
                  onChange={(e) => setReminder({ ...reminder, subject: e.target.value })}
                  placeholder="Subject"
                  aria-label="Subject"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
                />
                <textarea
                  disabled={mutation.pending}
                  required
                  value={reminder.body}
                  onChange={(e) => setReminder({ ...reminder, body: e.target.value })}
                  aria-label="Message"
                  className="min-h-40 w-full rounded-md border p-3 text-sm outline-none focus:border-ring"
                />
              </div>
              {(mailError || mutation.error) && (
                <ErrorState message={mailError || mutation.error} />
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  disabled={mutation.pending}
                  type="button"
                  onClick={close}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  disabled={sending || mutation.pending || !d?.gmailConnected}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending…" : "Send email"}
                </button>
              </div>
            </form>
          )}
        </FormDialog>
      ) : null}
      {noteOpen ? (
        <FormDialog
          title="Add internal note"
          description="Record a call, decision or follow-up for this repair."
          guardNavigation={false}
          dirty={Boolean(note)}
          busy={mutation.pending}
          onClose={() => {
            setNoteOpen(false);
            setNote("");
            mutation.clearError();
          }}
        >
          {({ close }) => (
            <form onSubmit={(e) => void submitNote(e)} className="form-stack">
              <textarea
                disabled={mutation.pending}
                autoFocus
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Internal note"
                placeholder="Record a call, decision or follow-up…"
                className="mt-4 min-h-28 w-full rounded-md border p-3 text-sm outline-none focus:border-ring"
              />
              {mutation.error && <ErrorState message={mutation.error} />}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  disabled={mutation.pending}
                  type="button"
                  onClick={close}
                  className="rounded-md border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  disabled={mutation.pending}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  {mutation.pending ? "Saving note…" : "Add note"}
                </button>
              </div>
            </form>
          )}
        </FormDialog>
      ) : null}
    </AppShell>
  );
}
