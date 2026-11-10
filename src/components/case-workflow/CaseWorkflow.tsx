import { AppointmentAlternatives } from "../AssistantExtras";
import { CancelVisit, FileManagement } from "./Management";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  closeCase,
  getCaseRecords,
  getCaseFile,
  uploadCaseFile,
  recordQuoteDecision,
  rescheduleVisit,
  listFollowUps,
} from "@/lib/case-workflow.functions";
import type { getIncident } from "@/lib/incidents.functions";
export type Incident = Awaited<ReturnType<typeof getIncident>>;
export const field = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
export const button = "rounded-md border bg-card px-3 py-2 text-sm disabled:opacity-50";
export const primary =
  "rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50";
export function WorkflowDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[85vh] w-[640px] max-w-[95vw] overflow-y-auto rounded-xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/40"
      aria-label={title}
    >
      <header className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button disabled={busy} onClick={onClose} className={button} aria-label="Close dialog">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function useWorkflowRefresh(id: string) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["incident", id] }),
      client.invalidateQueries({ queryKey: ["requests"] }),
      client.invalidateQueries({ queryKey: ["case-records", id] }),
      client.invalidateQueries({ queryKey: ["follow-ups"] }),
      client.invalidateQueries({ queryKey: ["notifications"] }),
      client.invalidateQueries({ queryKey: ["waiting-cases"] }),
      client.invalidateQueries({ queryKey: ["incident-actions", id] }),
      client.invalidateQueries({ queryKey: ["appointments"] }),
    ]);
  };
}
export function QuoteDecisionButton({
  quote,
  data,
  requestId,
}: {
  quote: Incident["quotes"][number];
  data: Incident;
  requestId: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    decision: "Approved" as "Approved" | "Rejected",
    method: "email" as "email" | "phone",
    emailId: "",
    evidence: "",
    confirmed: false,
  });
  const refresh = useWorkflowRefresh(requestId);
  const emails = data.emails.filter(
    (m) =>
      !m.outgoing &&
      data.participants.some(
        (p) => p.role === "Landlord" && p.email.toLowerCase() === m.fromEmail.toLowerCase(),
      ),
  );
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        Record landlord decision
      </button>
      {open && (
        <WorkflowDialog title="Record landlord decision" busy={busy} onClose={() => setOpen(false)}>
          <p className="mb-4">
            {quote.supplier} · <strong>${quote.amount.toFixed(2)}</strong>
          </p>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await recordQuoteDecision({
                  data: {
                    id: quote.id,
                    decision: form.decision,
                    method: form.method,
                    evidence: form.evidence,
                    ...(form.method === "email" ? { emailId: form.emailId } : {}),
                    amount: quote.amount,
                  },
                });
                await refresh();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not record decision");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block">
              Decision
              <select
                className={field}
                value={form.decision}
                onChange={(e) =>
                  setForm({ ...form, decision: e.target.value as typeof form.decision })
                }
              >
                <option value="Approved">Landlord approved</option>
                <option value="Rejected">Landlord rejected</option>
              </select>
            </label>
            <label className="block">
              Evidence source
              <select
                className={field}
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as typeof form.method })}
              >
                <option value="email">Linked landlord email</option>
                <option value="phone">Phone confirmation</option>
              </select>
            </label>
            {form.method === "email" && (
              <>
                <label className="block">
                  Landlord email
                  <select
                    required
                    className={field}
                    value={form.emailId}
                    onChange={(e) => setForm({ ...form, emailId: e.target.value })}
                  >
                    <option value="">Select evidence…</option>
                    {emails.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.subject} · {new Date(m.receivedAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                {!emails.length && (
                  <p>
                    No landlord email is linked yet. Link it in the timeline, or record a phone
                    confirmation.
                  </p>
                )}
                {form.emailId && (
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-sm">
                    {emails.find((m) => m.id === form.emailId)?.body}
                  </p>
                )}
              </>
            )}
            <label className="block">
              What did the landlord confirm? Include the call date if by phone.
              <textarea
                required
                minLength={5}
                maxLength={2000}
                className={field}
                value={form.evidence}
                onChange={(e) => setForm({ ...form, evidence: e.target.value })}
              />
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                required
                checked={form.confirmed}
                onChange={(e) => setForm({ ...form, confirmed: e.target.checked })}
              />
              I checked the evidence and the ${quote.amount.toFixed(2)} quote amount.
            </label>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button disabled={busy || !form.confirmed} className={primary}>
              {busy ? "Saving…" : "Confirm recorded decision"}
            </button>
          </form>
        </WorkflowDialog>
      )}
    </>
  );
}
export function RescheduleButton({
  appointment,
  requestId,
}: {
  appointment: Incident["appointments"][number];
  requestId: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [when, setWhen] = useState(() => {
      const d = new Date(appointment.startsAt);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    }),
    [location, setLocation] = useState(appointment.location),
    [reason, setReason] = useState("");
  const [duration, setDuration] = useState(
    String(
      Math.round(
        ((appointment.endsAt ?? appointment.startsAt + 3600000) - appointment.startsAt) / 60000,
      ),
    ),
  );
  const [attendees, setAttendees] = useState(
    (JSON.parse(appointment.attendeeEmails ?? "[]") as string[]).join(", "),
  );
  const refresh = useWorkflowRefresh(requestId);
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        Reschedule
      </button>
      {open && (
        <WorkflowDialog title="Reschedule repair visit" busy={busy} onClose={() => setOpen(false)}>
          <p className="mb-4">Current: {new Date(appointment.startsAt).toLocaleString()}</p>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const result = await rescheduleVisit({
                  data: {
                    id: appointment.id,
                    previousStart: appointment.startsAt,
                    startsAt: new Date(when).getTime(),
                    endsAt: new Date(when).getTime() + Number(duration) * 60000,
                    attendeeEmails: attendees
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    location,
                    reason,
                  },
                });
                await refresh();
                setOpen(false);
                window.dispatchEvent(
                  new CustomEvent("workflow-notice", {
                    detail: `Visit updated. ${result.drafts} notification drafts ready for review in the action plan.`,
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not reschedule");
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              type="button"
              className={button}
              onClick={() => {
                const d = new Date(when || appointment.startsAt);
                d.setDate(d.getDate() + 1);
                d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                setWhen(d.toISOString().slice(0, 16));
              }}
            >
              Move one day later
            </button>
            <label className="block">
              New date and time (your local time)
              <input
                type="datetime-local"
                required
                className={field}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <label className="block">
              Duration (minutes)
              <input
                type="number"
                min="15"
                max="1440"
                step="15"
                required
                className={field}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
            <label className="block">
              Attendee emails
              <input
                className={field}
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="Separate with commas"
              />
            </label>
            <AppointmentAlternatives
              action="appointment.update"
              args={{
                id: appointment.id,
                startsAt: new Date(when).getTime(),
                endsAt: new Date(when).getTime() + Number(duration) * 60000,
                attendeeEmails: attendees
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }}
              onSelect={(args) => {
                const d = new Date(Number(args["startsAt"]));
                setWhen(
                  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
                );
              }}
            />
            <label className="block">
              Location
              <input
                required
                className={field}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label className="block">
              Reason
              <textarea
                minLength={3}
                required
                className={field}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              This updates the visit and prepares tenant and repair-team drafts. Review and confirm
              each email in the action plan.
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button className={primary} disabled={busy}>
              {busy ? "Saving…" : "Update visit & prepare drafts"}
            </button>
          </form>
        </WorkflowDialog>
      )}
    </>
  );
}
export function CaseRecords({
  requestId,
  completed,
  incident,
}: {
  requestId: string;
  completed: boolean;
  incident: Incident;
}) {
  const [recycle, setRecycle] = useState(false);
  const futureVisits = incident.appointments.filter(
    (a) => !a.cancelledAt && a.startsAt > Date.now(),
  );
  const refresh = useWorkflowRefresh(requestId);
  const records = useQuery({
    queryKey: ["case-records", requestId],
    queryFn: () => getCaseRecords({ data: { requestId } }),
  });
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const [category, setCategory] = useState<"Damage photo" | "Quote" | "Completion photo" | "Other">(
    "Damage photo",
  );
  const [closure, setClosure] = useState({
    type: "repair_completed" as "repair_completed" | "non_repair",
    outcome: "",
    cost: "",
    tenantConfirmation: "confirmed" as "confirmed" | "not_required" | "not_confirmed",
    confirmationNote: "",
    retainFutureVisits: false,
    futureVisitReason: "",
  });
  return (
    <section id="case-records" className="space-y-4 rounded-lg border bg-card p-5">
      <header className="flex justify-between gap-4">
        <div>
          <h2 className="font-semibold">Case files & outcome</h2>
          <p className="text-sm text-muted-foreground">
            Damage photos, quotes, completion evidence and closure history.
          </p>
        </div>
        {!completed && (
          <button className={primary} onClick={() => setOpen(true)}>
            Close case
          </button>
        )}
      </header>
      {records.isError && (
        <button className={button} onClick={() => void records.refetch()}>
          Could not load records. Retry
        </button>
      )}
      {!completed && (
        <div className="flex items-end gap-3">
          <label>
            File category
            <select
              className={field}
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              {["Damage photo", "Quote", "Completion photo", "Other"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            Upload file · PNG, JPG, WebP or PDF · up to 1 MB
            <input
              className={field}
              disabled={busy}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setError("");
                if (file.size > 1024 * 1024) {
                  setError("Choose a file no larger than 1 MB.");
                  return;
                }
                setBusy(true);
                try {
                  const content = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
                    reader.onerror = () => reject(new Error("Could not read file"));
                    reader.readAsDataURL(file);
                  });
                  await uploadCaseFile({
                    data: {
                      requestId,
                      id: crypto.randomUUID(),
                      name: file.name,
                      mime: file.type as "image/png",
                      category,
                      content,
                    },
                  });
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        </div>
      )}
      {busy && <p role="status">Saving…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <button className={button} onClick={() => setRecycle(!recycle)}>
        {recycle
          ? "Show active files"
          : `Recycle bin (${records.data?.files.filter((f) => f.trashedAt).length ?? 0})`}
      </button>
      <div className="space-y-2">
        {records.data?.files
          .filter((f) => Boolean(f.trashedAt) === recycle)
          .map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between rounded border p-3 text-sm"
            >
              <span>
                {file.name} {file.quoteId ? `· Quote #${file.quoteId}` : ""} · {file.category} ·{" "}
                {Math.ceil(file.size / 1024)} KB
              </span>
              <FileManagement file={file} requestId={requestId} quotes={incident.quotes} />
              {file.mime.startsWith("image/") && (
                <button
                  className={button}
                  onClick={async () => {
                    try {
                      const f = await getCaseFile({ data: { id: file.id } });
                      const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
                      setPreview({
                        url: URL.createObjectURL(new Blob([bytes], { type: f.mime })),
                        name: f.name,
                      });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not preview image");
                    }
                  }}
                >
                  Preview
                </button>
              )}
              <button
                className={button}
                onClick={async () => {
                  try {
                    const f = await getCaseFile({ data: { id: file.id } });
                    const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
                    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = f.name;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Download failed");
                  }
                }}
              >
                Download
              </button>
            </div>
          ))}
        {records.data && !records.data.files.length && (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        )}
      </div>
      {records.data?.decisions.map((q) => (
        <details key={q.id} className="rounded border p-3 text-sm">
          <summary>
            Quote #{q.quoteId} · {q.decision} · ${(q.amountCents / 100).toFixed(2)}
          </summary>
          <p>
            {q.method} · {new Date(q.at).toLocaleString()}
          </p>
          <p className="whitespace-pre-wrap">{q.evidence}</p>
        </details>
      ))}
      {preview && (
        <WorkflowDialog title={preview.name} onClose={() => setPreview(null)}>
          <img
            src={preview.url}
            alt={preview.name}
            className="max-h-[65vh] w-full object-contain"
          />
        </WorkflowDialog>
      )}
      {records.data?.closures.map((c) => (
        <details key={c.id} className="rounded border p-3 text-sm">
          <summary>
            {c.type === "non_repair" ? "Closed as non-repair" : "Repair completed"} ·{" "}
            {new Date(c.at).toLocaleString()}
          </summary>
          <p>{c.outcome}</p>
          <p>
            Actual cost:{" "}
            {c.costCents === null ? "Not applicable" : `$${(c.costCents / 100).toFixed(2)}`}
          </p>
          <p>Tenant confirmation: {c.tenantConfirmation}</p>
        </details>
      ))}
      {open && (
        <WorkflowDialog title="Close case" busy={busy} onClose={() => setOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await closeCase({
                  data: {
                    requestId,
                    ...closure,
                    cost:
                      closure.type === "non_repair"
                        ? null
                        : closure.cost === ""
                          ? null
                          : Number(closure.cost),
                  },
                });
                await refresh();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not close case");
              } finally {
                setBusy(false);
              }
            }}
          >
            {futureVisits.length > 0 && (
              <fieldset className="space-y-3 rounded border border-amber-300 p-3">
                <legend>Future visits must be resolved</legend>
                <p>
                  Cancel the visit and review its notification drafts before closing, or retain it
                  with a reason.
                </p>
                {futureVisits.map((a) => (
                  <div key={a.id} className="flex items-center justify-between">
                    <span>
                      {a.title} · {new Date(a.startsAt).toLocaleString()}
                    </span>
                    <CancelVisit appointment={{ ...a, requestId }} onChanged={refresh} />
                  </div>
                ))}
                <label className="block">
                  <input
                    type="checkbox"
                    checked={closure.retainFutureVisits}
                    onChange={(e) =>
                      setClosure({ ...closure, retainFutureVisits: e.target.checked })
                    }
                  />{" "}
                  Keep the future visits after closure
                </label>
                {closure.retainFutureVisits && (
                  <label className="block">
                    Reason for keeping visits
                    <textarea
                      required
                      minLength={3}
                      className={field}
                      value={closure.futureVisitReason}
                      onChange={(e) =>
                        setClosure({ ...closure, futureVisitReason: e.target.value })
                      }
                    />
                  </label>
                )}
              </fieldset>
            )}
            <label className="block">
              Outcome type
              <select
                className={field}
                value={closure.type}
                onChange={(e) =>
                  setClosure({ ...closure, type: e.target.value as typeof closure.type })
                }
              >
                <option value="repair_completed">Repair completed</option>
                <option value="non_repair">Not a repair / misdirected email</option>
              </select>
            </label>
            <label className="block">
              What happened?
              <textarea
                required
                minLength={5}
                className={field}
                value={closure.outcome}
                onChange={(e) => setClosure({ ...closure, outcome: e.target.value })}
              />
            </label>
            {closure.type === "repair_completed" && (
              <>
                <label className="block">
                  Actual cost ($)
                  <input
                    required
                    min="0"
                    step="0.01"
                    type="number"
                    className={field}
                    value={closure.cost}
                    onChange={(e) => setClosure({ ...closure, cost: e.target.value })}
                  />
                </label>
                <label className="block">
                  Tenant confirmation
                  <select
                    className={field}
                    value={closure.tenantConfirmation}
                    onChange={(e) =>
                      setClosure({
                        ...closure,
                        tenantConfirmation: e.target.value as typeof closure.tenantConfirmation,
                      })
                    }
                  >
                    <option value="confirmed">Tenant confirmed resolution</option>
                    <option value="not_confirmed">Not confirmed — record why closing</option>
                    <option value="not_required">Not required — record reason</option>
                  </select>
                </label>
                <label className="block">
                  Confirmation details or reason
                  <textarea
                    required
                    className={field}
                    value={closure.confirmationNote}
                    onChange={(e) => setClosure({ ...closure, confirmationNote: e.target.value })}
                  />
                </label>
              </>
            )}
            <p className="text-sm text-muted-foreground">
              Closing stops follow-up reminders. The case history and files are retained.
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button className={primary} disabled={busy}>
              {busy ? "Saving…" : "Confirm closure"}
            </button>
          </form>
        </WorkflowDialog>
      )}
    </section>
  );
}
export function FollowUps() {
  const query = useQuery({
    queryKey: ["follow-ups"],
    queryFn: () => listFollowUps(),
    refetchInterval: 60000,
  });
  const [showAll, setShowAll] = useState(false);
  const now = Date.now();
  const rows = (query.data ?? []).filter((a) => showAll || a.dueAt! <= now);
  return (
    <section className="rounded-xl border bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">
          Follow-ups · {(query.data ?? []).filter((a) => a.dueAt! <= now).length} due
        </h2>
        <button className={button} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Due only" : "Show upcoming"}
        </button>
      </header>
      {query.isError ? (
        <button className={button} onClick={() => void query.refetch()}>
          Could not load follow-ups. Retry
        </button>
      ) : query.isLoading ? (
        <p>Loading follow-ups…</p>
      ) : !rows.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {showAll
            ? "No follow-ups scheduled."
            : "No follow-ups due. Set a date on an event action."}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              to="/requests/$id"
              params={{ id: a.requestId }}
              className="flex justify-between gap-4 rounded border p-3 text-sm"
            >
              <span>
                {a.requestId} · {a.title}
                <small className="block text-muted-foreground">{a.address}</small>
              </span>
              <span>
                {a.dueAt! <= now ? "Due · " : ""}
                {new Date(a.dueAt!).toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
