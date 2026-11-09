import { useState } from "react";
import { manageAction, createContactDraft } from "@/lib/case-workflow.functions";
import { WorkflowDialog, field, button, primary, type Incident } from "./CaseWorkflow";
type Action = Incident["actions"][number];
export function ActionControls({
  action,
  data,
  onRefresh,
  onQuote,
}: {
  action: Action;
  data: Incident;
  onRefresh: () => Promise<unknown>;
  onQuote: () => void;
}) {
  const [open, setOpen] = useState(false),
    [replyOpen, setReplyOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [operation, setOperation] = useState<
    "skip" | "done" | "defer" | "restore" | "followup" | "clear_followup"
  >("followup");
  const [reason, setReason] = useState(""),
    [when, setWhen] = useState("");
  const [question, setQuestion] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const reply = data.emails.find((m) => m.id === action.replyId);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onRefresh();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this change");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2 text-xs">
      {action.disposition !== "open" && (
        <p className="font-medium">
          {action.disposition} · {action.dispositionNote}
        </p>
      )}
      {action.followUpAt && (
        <p>
          Follow up {action.followUpAt <= Date.now() ? "due" : "on"}{" "}
          {new Date(action.followUpAt).toLocaleString()}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!data.closed && action.state !== "sending" && (
          <button
            className={button}
            onClick={() => {
              setOperation(
                action.state === "sent"
                  ? "followup"
                  : action.disposition === "open"
                    ? "done"
                    : "restore",
              );
              setOpen(true);
            }}
          >
            Manage action
          </button>
        )}
        {reply && (
          <button className={button} onClick={() => setReplyOpen(true)}>
            {action.replyHandled ? "View handled reply" : "Review reply"}
          </button>
        )}
      </div>
      {action.followUpAt &&
        action.followUpAt <= Date.now() &&
        !data.closed &&
        action.recipientEmail && (
          <button
            className={primary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await createContactDraft({
                  data: {
                    requestId: action.requestId,
                    email: action.recipientEmail!,
                    subject: `Follow-up: ${action.subject}`.slice(0, 300),
                    body: `Hi ${action.recipientName},\n\nI am following up on ${action.title.toLowerCase()}. Could you please provide an update?\n\nThank you.`,
                    operationId: draftId,
                  },
                });
                setDraftId(crypto.randomUUID());
                await manageAction({
                  data: {
                    id: action.id,
                    operation: "clear_followup",
                    reason: "Follow-up draft prepared for review",
                  },
                });
              })
            }
          >
            Prepare reminder draft
          </button>
        )}
      {error && !open && !replyOpen && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {open && (
        <WorkflowDialog title="Manage action" busy={busy} onClose={() => setOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                manageAction({
                  data: {
                    id: action.id,
                    operation,
                    reason,
                    ...(["defer", "followup"].includes(operation)
                      ? { dueAt: new Date(when).getTime() }
                      : {}),
                  },
                }),
              );
            }}
          >
            <p>{action.title}</p>
            <label className="block">
              What would you like to do?
              <select
                className={field}
                value={operation}
                onChange={(e) => setOperation(e.target.value as typeof operation)}
              >
                {action.state === "pending" && (
                  <>
                    <option value="done">Completed offline / by phone</option>
                    <option value="skip">Not required</option>
                    <option value="defer">Defer action</option>
                    <option value="restore">Restore action</option>
                  </>
                )}
                <option value="followup">Set follow-up reminder</option>
                <option value="clear_followup">Clear follow-up reminder</option>
              </select>
            </label>
            <label className="block">
              Reason or outcome
              <textarea
                required={["skip", "done", "defer"].includes(operation)}
                maxLength={1000}
                className={field}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {["defer", "followup"].includes(operation) && (
              <>
                <div className="flex gap-2">
                  {[1, 2].map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={button}
                      onClick={() => {
                        const date = new Date(Date.now() + days * 86400000);
                        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
                        setWhen(date.toISOString().slice(0, 16));
                      }}
                    >
                      {days === 1 ? "Tomorrow" : "In two days"}
                    </button>
                  ))}
                </div>
                <label className="block">
                  Follow-up time
                  <input
                    type="datetime-local"
                    required
                    className={field}
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button className={primary} disabled={busy}>
              {busy ? "Saving…" : "Save action update"}
            </button>
          </form>
        </WorkflowDialog>
      )}
      {replyOpen && reply && (
        <WorkflowDialog title="Review action reply" busy={busy} onClose={() => setReplyOpen(false)}>
          <div className="space-y-4">
            <div>
              <strong>{reply.subject}</strong>
              <p>
                {reply.fromName} · {new Date(reply.receivedAt).toLocaleString()}
              </p>
            </div>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border p-3 text-sm">
              {reply.body}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={primary}
                disabled={busy || action.replyHandled || data.closed}
                onClick={() =>
                  void run(async () => {
                    await manageAction({
                      data: {
                        id: action.id,
                        operation: "reply_done",
                        replyId: reply.id,
                        reason: "Information reviewed and complete",
                      },
                    });
                    setReplyOpen(false);
                  })
                }
              >
                Information complete
              </button>
              <button
                className={button}
                onClick={() => {
                  setReplyOpen(false);
                  onQuote();
                }}
              >
                Record a quote
              </button>
            </div>
            <label className="block">
              Still need information? Draft a follow-up
              <textarea
                className={field}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Write the question you want to ask…"
              />
            </label>
            <button
              className={button}
              disabled={busy || !question.trim() || !action.recipientEmail || data.closed}
              onClick={() =>
                void run(async () => {
                  await createContactDraft({
                    data: {
                      requestId: action.requestId,
                      email: action.recipientEmail!,
                      subject: `Follow-up: ${reply.subject}`.slice(0, 300),
                      body: question,
                      operationId: draftId,
                    },
                  });
                  setDraftId(crypto.randomUUID());
                  setQuestion("");
                  setReplyOpen(false);
                })
              }
            >
              Prepare follow-up draft
            </button>
            <p className="text-sm text-muted-foreground">
              A reply does not approve a quote or complete the repair. Review the follow-up draft
              separately before sending.
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        </WorkflowDialog>
      )}
    </div>
  );
}
