import { AttachmentPicker } from "@/components/case-workflow/Management";
import { ActionControls } from "@/components/case-workflow/ActionControls";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  CheckCheck,
  ChevronRight,
  FileText,
  LockKeyhole,
  Mail,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { saveIncidentAction, sendIncidentAction } from "@/lib/incident-actions.functions";
import type { getIncident } from "@/lib/incidents.functions";
import { expectsReply, type ActionDraft } from "@/lib/incident-action-types";
import "./incident-actions.css";

type Incident = Awaited<ReturnType<typeof getIncident>>;
type Action = Incident["actions"][number];
type Tab = "ready" | "blocked" | "sent" | "handled";
export function IncidentActions({
  data,
  analyzing,
  error,
  onGenerate,
  onRefresh,
  onAddQuote,
  onAddPeople,
  onLinkProperty,
}: {
  data: Incident | undefined;
  analyzing: boolean;
  error: string;
  onGenerate: () => void;
  onRefresh: () => Promise<unknown>;
  onAddQuote: () => void;
  onAddPeople: () => void;
  onLinkProperty: () => void;
}) {
  const [tab, setTab] = useState<Tab>("ready");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = data?.actions ?? [];
  const handled = actions.filter((a) => ["done", "skipped"].includes(a.disposition));
  const ready = actions.filter((a) => a.state === "pending" && !a.blockedReason);
  const blocked = actions.filter(
    (a) => a.state === "pending" && a.blockedReason && !["done", "skipped"].includes(a.disposition),
  );
  const sent = actions.filter((a) => a.state === "sent");
  const waitingSent = sent.filter((a) => expectsReply(a.kind) && !a.replyHandled);
  const sending = actions.filter((a) => a.state === "sending");
  const visible =
    tab === "ready"
      ? [...sending, ...ready]
      : tab === "blocked"
        ? blocked
        : tab === "handled"
          ? handled
          : sent;
  const review = actions.find((a) => a.id === selected);
  const close = () => {
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const tabs = [
    ["ready", "Ready now", ready.length + sending.length],
    ["blocked", "Waiting on conditions", blocked.length],
    ["sent", "Sent", sent.length],
    ["handled", "Handled", handled.length],
  ] as const;
  return (
    <section className="incident-actions">
      <div className="ia-plan">
        {data?.closed && (
          <p className="ia-draft-notice">This case is closed. Reopen it to resume actions.</p>
        )}
        <header className="ia-heading">
          <h2>
            <Sparkles size={20} />
            AI action plan
          </h2>
          <button
            className="ia-button secondary"
            onClick={onGenerate}
            disabled={analyzing || !data || data.closed}
          >
            <RotateCcw size={14} className={analyzing ? "animate-spin" : ""} />
            {analyzing ? "Analysing…" : data?.ai ? "Regenerate plan" : "Generate action plan"}
          </button>
        </header>
        <p className="ia-summary">
          {data?.ai?.summary ??
            "Read the linked emails, property contacts, quotes and appointments to prepare separate actions for each person."}
        </p>
        {data?.ai ? (
          <div className="ia-progress">
            <div>
              <span>
                {sent.length + handled.length} of {actions.length} actions handled
              </span>
              <span>{ready.length} ready now</span>
            </div>
            <progress
              value={sent.length + handled.length}
              max={Math.max(actions.length, 1)}
              aria-label="Handled actions"
            />
          </div>
        ) : null}
        <div role="tablist" aria-label="Action plan" className="ia-tabs">
          {tabs.map(([key, label, count], i) => (
            <button
              key={key}
              role="tab"
              id={`ia-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="ia-actions"
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(e) => {
                const next =
                  e.key === "ArrowRight"
                    ? tabs[(i + 1) % tabs.length]?.[0]
                    : e.key === "ArrowLeft"
                      ? tabs[(i + tabs.length - 1) % tabs.length]?.[0]
                      : undefined;
                if (next) {
                  e.preventDefault();
                  setTab(next);
                  document.getElementById(`ia-tab-${next}`)?.focus();
                }
              }}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div
          id="ia-actions"
          role="tabpanel"
          aria-labelledby={`ia-tab-${tab}`}
          className="ia-action-list"
        >
          {visible.map((a, i) => (
            <article key={a.id} className={`ia-action ${a.blockedReason ? "blocked" : ""}`}>
              <span className="ia-number">
                {a.state === "sent" ? (
                  <Check size={15} />
                ) : a.blockedReason && !a.needsReview ? (
                  <LockKeyhole size={15} />
                ) : (
                  i + 1
                )}
              </span>
              <div className="ia-copy">
                <h3>{a.title}</h3>
                <p>
                  {a.recipientEmail
                    ? `To ${a.recipientName} · ${a.recipientRole}`
                    : `${a.recipientRole} contact needed`}
                </p>
                <span>{a.blockedReason ?? a.reason}</span>
                {a.editedAt && a.state === "pending" ? <small>Draft saved</small> : null}
                {a.state === "sent" ? (
                  <small>
                    {a.replyReceived
                      ? "Reply received · review in the timeline"
                      : expectsReply(a.kind)
                        ? "Sent · awaiting response or next step"
                        : "Sent · no response requested"}
                  </small>
                ) : null}
                {data && (
                  <ActionControls
                    action={a}
                    data={data}
                    onRefresh={onRefresh}
                    onQuote={onAddQuote}
                  />
                )}
              </div>
              {(data?.closed && a.state !== "sent") ||
              ["done", "skipped"].includes(a.disposition) ||
              (a.disposition === "deferred" &&
                !!a.followUpAt &&
                a.followUpAt > Date.now()) ? null : a.state === "sent" ? (
                <button
                  className="ia-sent-link"
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    setSelected(a.id);
                  }}
                >
                  <CheckCheck size={15} />
                  View email
                </button>
              ) : a.blockedReason && !a.needsReview ? (
                <button
                  className="ia-button secondary"
                  onClick={() => {
                    if (a.blockedReason?.includes("quote")) onAddQuote();
                    else if (a.blockedReason?.includes("contact")) onAddPeople();
                    else if (a.blockedReason?.includes("property")) onLinkProperty();
                    else onGenerate();
                  }}
                >
                  {a.blockedReason.includes("quote")
                    ? "View quotes"
                    : a.blockedReason.includes("contact")
                      ? "View people"
                      : a.blockedReason.includes("property")
                        ? "Link property"
                        : "Regenerate"}
                </button>
              ) : (
                <button
                  className="ia-button primary"
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    setSelected(a.id);
                  }}
                >
                  {a.state === "sending"
                    ? "Check delivery"
                    : a.needsReview
                      ? "Review changes"
                      : "Review draft"}
                </button>
              )}
            </article>
          ))}
          {visible.length === 0 ? (
            <div className="ia-empty">
              <Mail size={25} />
              <strong>
                {!data?.ai
                  ? "Prepare the next steps."
                  : tab === "ready"
                    ? "No actions ready right now."
                    : tab === "blocked"
                      ? "No actions are blocked."
                      : "No actions in this view yet."}
              </strong>
              <p>
                {!data?.ai
                  ? "Generate a plan to see parallel tasks and their dependencies."
                  : actions.length === 0
                    ? "The AI has not proposed email actions. Review the summary or regenerate the plan."
                    : tab === "ready"
                      ? "Check waiting conditions, or review responses below."
                      : "Actions are tracked separately, with their own drafts and results."}
              </p>
            </div>
          ) : null}
        </div>
        {tab === "ready" && blocked.length > 0 ? (
          <button className="ia-up-next" onClick={() => setTab("blocked")}>
            <LockKeyhole size={16} />
            <span>
              {blocked.length} {blocked.length === 1 ? "action needs" : "actions need"} more
              information or a prerequisite.
            </span>
            <ChevronRight size={16} />
          </button>
        ) : null}
        {actionError ? (
          <p className="ia-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {error ? (
          <p className="ia-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="ia-footnote">
          Review each draft before sending. Generating a plan never sends emails or marks repairs as
          completed.
        </p>
      </div>
      <aside className="ia-waiting">
        <h2>Waiting on</h2>
        {waitingSent.length === 0 ? (
          <div className="ia-waiting-empty">
            <FileText size={20} />
            <p>Actions that request a response are tracked here after sending.</p>
          </div>
        ) : (
          waitingSent.map((a) => (
            <div className="ia-condition" key={a.id}>
              <Mail size={16} />
              <div>
                <strong>{a.recipientName}</strong>
                <p>{a.title}</p>
                <span className={a.replyReceived ? "received" : ""}>
                  {a.replyReceived ? "Reply received · review" : "Awaiting response"}
                </span>
              </div>
            </div>
          ))
        )}
        {sending.length ? (
          <p className="ia-error">
            {sending.length} delivery {sending.length === 1 ? "needs" : "need"} confirmation. Use
            “Check delivery” to reconcile safely.
          </p>
        ) : null}
        <div className="ia-context">
          <Building2 size={15} />
          <span>Property contacts determine recipients. A reply alone never approves a quote.</span>
        </div>
      </aside>
      {review ? (
        <ActionReview
          key={`${review.id}:${review.state}`}
          action={review}
          gmailConnected={data?.gmailConnected ?? false}
          caseSummary={data?.ai?.summary ?? "Review the latest case timeline before confirming."}
          onClose={close}
          onSave={async (draft) => {
            await saveIncidentAction({
              data: {
                id: review.id,
                draft,
                ...(review.needsReview ? { reviewedVersion: data?.planVersion } : {}),
              },
            });
            await onRefresh();
            setNotice("Draft saved. Nothing was sent.");
            close();
          }}
          onSend={async (draft) => {
            setActionError("");
            if (review.needsReview)
              await saveIncidentAction({
                data: { id: review.id, draft, reviewedVersion: data?.planVersion },
              });
            const result = await sendIncidentAction({ data: { id: review.id, draft } });
            if (!result.ok) setActionError(result.message);
            await onRefresh();
            if (!result.ok) throw new Error(result.message);
            setNotice("Email sent and action recorded.");
            close();
          }}
        />
      ) : null}
      {notice ? (
        <div className="ia-toast" role="status">
          <CheckCheck size={16} />
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
function ActionReview({
  action,
  gmailConnected,
  caseSummary,
  onClose,
  onSave,
  onSend,
}: {
  action: Action;
  gmailConnected: boolean;
  caseSummary: string;
  onClose: () => void;
  onSave: (d: ActionDraft) => Promise<void>;
  onSend: (d: ActionDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    subject: action.subject,
    body: action.body,
    attachmentIds: JSON.parse(action.attachmentIds) as string[],
  });
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const locked = action.state !== "pending";
  const dirty =
    !locked &&
    (draft.subject !== action.subject ||
      draft.body !== action.body ||
      JSON.stringify(draft.attachmentIds) !== action.attachmentIds);
  const requestClose = () => {
    if (dirty) setLeavePrompt(true);
    else onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  const run = async (send: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await (send ? onSend(draft) : onSave(draft));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action. Refresh and try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="ia-review"
      aria-labelledby="ia-review-title"
      onCancel={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        requestClose();
      }}
    >
      <header>
        <h2 id="ia-review-title">{action.state === "sent" ? "Sent email" : "Review draft"}</h2>
        <button disabled={busy} aria-label="Close draft" onClick={requestClose}>
          <X size={19} />
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(true);
        }}
      >
        <div className="ia-review-body">
          <h3>{action.title}</h3>
          <div className="ia-draft-notice">
            <Sparkles size={19} />
            <p>
              {action.state === "sent"
                ? "This action has already been sent. It will not be sent again."
                : action.state === "sending"
                  ? "Delivery is being reconciled. This exact draft is locked to prevent duplicate emails."
                  : "Review the recipient and edit the message. Nothing sends until you confirm."}
            </p>
          </div>
          {action.needsReview ? (
            <div className="ia-draft-notice">
              <div>
                <strong>Case information changed</strong>
                <p>{caseSummary}</p>
                <p>
                  Your saved draft has been preserved. Compare it with the latest timeline, contacts
                  and quote before continuing.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />{" "}
                  I reviewed the updated case and this draft is still accurate.
                </label>
              </div>
            </div>
          ) : null}
          <label>
            To
            <input readOnly value={`${action.recipientName} <${action.recipientEmail ?? ""}>`} />
          </label>
          <label>
            Subject
            <input
              autoFocus
              required
              maxLength={300}
              readOnly={locked}
              disabled={busy}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </label>
          <label className="ia-message">
            Email message
            <textarea
              required
              maxLength={20000}
              readOnly={locked}
              disabled={busy}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          {locked ? (
            action.sentAttachments.length > 0 && (
              <p className="text-sm">Attachments: {action.sentAttachments.join(", ")}</p>
            )
          ) : (
            <AttachmentPicker
              requestId={action.requestId}
              value={draft.attachmentIds}
              onChange={(attachmentIds) => setDraft({ ...draft, attachmentIds })}
              disabled={busy}
            />
          )}
          {!gmailConnected && action.state !== "sent" ? (
            <p className="ia-error">
              Connect Gmail in the <Link to="/inbox">Unified Inbox</Link> before sending.
            </p>
          ) : null}
          {action.blockedReason ? <p className="ia-error">{action.blockedReason}</p> : null}
          {error ? (
            <p className="ia-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {leavePrompt && (
          <div className="ia-draft-notice">
            <div>
              <strong>Save your draft changes?</strong>
              <p>Your changes have not been saved.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ia-button primary"
                  disabled={busy || (action.needsReview && !reviewed)}
                  onClick={() => void run(false)}
                >
                  Save & close
                </button>
                <button
                  type="button"
                  className="ia-button secondary"
                  disabled={busy}
                  onClick={onClose}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  className="ia-button secondary"
                  onClick={() => setLeavePrompt(false)}
                >
                  Continue editing
                </button>
              </div>
            </div>
          </div>
        )}
        <footer>
          {action.state === "sent" ? (
            <button type="button" className="ia-button secondary" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <span>
                {action.state === "sending"
                  ? "Retry checks the same message."
                  : "One action, one reviewed email."}
              </span>
              <div>
                {!locked ? (
                  <button
                    type="button"
                    className="ia-button secondary"
                    disabled={
                      busy ||
                      (action.needsReview && !reviewed) ||
                      !draft.subject.trim() ||
                      !draft.body.trim()
                    }
                    onClick={() => void run(false)}
                  >
                    Save changes
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="ia-button primary"
                  disabled={
                    busy ||
                    !gmailConnected ||
                    (action.needsReview ? !reviewed : !!action.blockedReason)
                  }
                >
                  <Send size={15} />
                  {busy
                    ? "Processing…"
                    : action.state === "sending"
                      ? "Check delivery"
                      : "Confirm & send"}
                </button>
              </div>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
