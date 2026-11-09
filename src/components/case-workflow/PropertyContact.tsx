import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { createContactDraft, getPropertyContactHistory } from "@/lib/case-workflow.functions";
import { WorkflowDialog, field, button, primary } from "./CaseWorkflow";
export function PropertyContact({
  propertyId,
  email,
  name,
}: {
  propertyId: number;
  email: string;
  name: string;
}) {
  const [open, setOpen] = useState(false),
    [eventId, setEventId] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [leavePrompt, setLeavePrompt] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = !!subject.trim() || !!body.trim();
  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);
  const navigate = useNavigate();
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["property-contact-history", propertyId, email],
    queryFn: () => getPropertyContactHistory({ data: { propertyId, email } }),
    enabled: open,
  });
  return (
    <>
      <button className="mt-2 text-xs text-primary underline" onClick={() => setOpen(true)}>
        Events, messages & contact
      </button>
      {open && (
        <WorkflowDialog
          title={`Contact ${name}`}
          busy={busy}
          onClose={() => (dirty ? setLeavePrompt(true) : setOpen(false))}
        >
          <p className="mb-4 text-sm">{email}</p>
          {leavePrompt && (
            <div className="mb-4 space-y-2 rounded border bg-muted p-3">
              <strong>Save your draft before leaving?</strong>
              <div className="flex flex-wrap gap-2">
                <button
                  className={primary}
                  disabled={!eventId || !subject.trim() || !body.trim() || busy}
                  onClick={() => formRef.current?.requestSubmit()}
                >
                  Save draft & open event
                </button>
                <button
                  className={button}
                  onClick={() => {
                    setSubject("");
                    setBody("");
                    setLeavePrompt(false);
                    setOpen(false);
                  }}
                >
                  Discard changes
                </button>
                <button className={button} onClick={() => setLeavePrompt(false)}>
                  Continue editing
                </button>
              </div>
            </div>
          )}

          {history.isLoading ? (
            <p>Loading contact history…</p>
          ) : history.isError ? (
            <button className={button} onClick={() => void history.refetch()}>
              Could not load contact history. Retry
            </button>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold">Related events</h3>
              {history.data?.events.map((r) => (
                <Link
                  key={r.id}
                  to="/requests/$id"
                  params={{ id: r.id }}
                  onClick={(e) => {
                    if (dirty) {
                      e.preventDefault();
                      setLeavePrompt(true);
                    }
                  }}
                  className="block text-sm text-primary"
                >
                  {r.id} · {r.title} · {r.completed ? "Completed" : "Active"}
                </Link>
              ))}
              {!history.data?.events.length && (
                <p className="text-sm">
                  No events linked to this contact. Create an event, or review its contacts first.
                </p>
              )}
              <details>
                <summary className="cursor-pointer font-medium">
                  Message history · {history.data?.emails.length ?? 0}
                </summary>
                <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
                  {history.data?.emails.map((m) => (
                    <details key={m.id} className="rounded border p-3 text-sm">
                      <summary>
                        {m.requestId} · {m.subject} · {new Date(m.at).toLocaleString()}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
                    </details>
                  ))}
                </div>
              </details>
              <form
                ref={formRef}
                className="space-y-3 border-t pt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    await createContactDraft({
                      data: { requestId: eventId, email, subject, body, operationId },
                    });
                    await client.invalidateQueries({ queryKey: ["incident", eventId] });
                    setOperationId(crypto.randomUUID());
                    setOpen(false);
                    setSubject("");
                    setBody("");
                    setLeavePrompt(false);
                    await navigate({ to: "/requests/$id", params: { id: eventId } });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not prepare draft");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3 className="font-semibold">Prepare an event email</h3>
                <label className="block">
                  Choose the event first
                  <select
                    required
                    className={field}
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                  >
                    <option value="">Choose active event…</option>
                    {history.data?.events
                      .filter((r) => !r.completed)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} · {r.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  Subject
                  <input
                    required
                    maxLength={300}
                    className={field}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label className="block">
                  Message
                  <textarea
                    required
                    maxLength={20000}
                    className={field}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  The draft belongs to the selected event. Review and confirm sending on its action
                  plan.
                </p>
                {error && (
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                )}
                <button className={primary} disabled={busy || !eventId}>
                  {busy ? "Preparing…" : "Prepare draft & open event"}
                </button>
              </form>
            </div>
          )}
        </WorkflowDialog>
      )}
    </>
  );
}
