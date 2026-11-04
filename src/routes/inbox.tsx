import { useDiscardGuard } from "@/hooks/use-discard-guard";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Inbox as InboxIcon,
  Mail,
  Reply,
  Search,
  Send,
  Trash2,
  PenSquare,
  Undo2,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  ErrorState,
  EmptyState,
  LoadingRows,
  StatusLabel,
  PendingLabel,
} from "@/components/workspace-ui";
import { useWorkspace } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import { disconnectGmail, getInbox, moveEmail, syncGmail } from "@/lib/gmail.functions";
import { linkEmail } from "@/lib/incidents.functions";
import { sendEmail } from "@/lib/send-email";
import { useDebouncedValue, useStoredPreference } from "@/hooks/use-ui-state";
import type { Priority } from "@/lib/data";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — RepairFlow" },
      { name: "description", content: "Review repair emails and coordinate the next action." },
    ],
  }),
  component: InboxPage,
});
const time = (ms: number) =>
  new Date(ms).toDateString() === new Date().toDateString()
    ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
function savedCreations(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          ([key, id]) => key.length < 500 && typeof id === "string" && /^REQ-\d+$/.test(id),
        ),
      )
    : {};
}
function InboxPage() {
  const { user, isSignedIn } = useAuth();
  const { requests, addRequest, notify } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: () => getInbox(),
    staleTime: Infinity,
    enabled: isSignedIn,
  });
  const inboxPermissionError =
    inbox.error instanceof Error && /unauthorized|forbidden/i.test(inbox.error.message);
  const connected = inbox.data?.connected === true;
  const emails = useMemo(() => (inbox.data?.connected ? inbox.data.emails : []), [inbox.data]);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query);
  const [folder, setFolder] = useState<"inbox" | "sent" | "trash">("inbox");
  const [selectedId, setSelectedId] = useState("");
  const selected = emails.find((m) => m.id === selectedId);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState("");
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftPriority, setDraftPriority] = useState<Priority>("Medium");
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkChoice, setLinkChoice] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [error, setError] = useState("");
  const locks = useRef({ send: false, create: false, move: false, sync: false, link: false });
  const mailbox = inbox.data?.connected ? inbox.data.email : "";
  const [createdByEmail, setCreatedByEmail] = useStoredPreference(
    user?.email && mailbox ? `repairflow.pending-email-repairs.v1:${user.email}:${mailbox}` : null,
    {} as Record<string, string>,
    savedCreations,
    "sessionStorage",
  );
  const createdRef = useRef(createdByEmail);
  createdRef.current = createdByEmail;
  const pendingId = selected ? createdByEmail[selected.id] : undefined;
  const reviewDirty = Boolean(
    selected &&
    !selected.requestId &&
    !pendingId &&
    (draftAddress || draftPriority !== "Medium" || draftTitle !== selected.subject.slice(0, 200)),
  );
  const guard = useDiscardGuard(
    Boolean(
      (composing && (to || subject || body || requestId)) || (replying && reply) || reviewDirty,
    ),
    sending || creating || moving || linking,
  );
  const list = useMemo(
    () =>
      emails
        .filter((m) =>
          folder === "trash" ? m.trashed : !m.trashed && (folder === "sent" ? m.sent : m.inInbox),
        )
        .filter(
          (m) =>
            ![m.fromName, m.fromEmail, m.toEmails, m.subject, m.snippet].every(
              (value) =>
                !value.toLowerCase().includes((query ? debounced : "").trim().toLowerCase()),
            ),
        ),
    [emails, folder, query, debounced],
  );
  const linkedRequest = selected?.requestId
    ? requests.find((r) => r.id === selected.requestId)
    : undefined;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["incident"] }),
    ]);
  const clearCompose = () => {
    setComposing(false);
    setTo("");
    setSubject("");
    setBody("");
    setRequestId("");
  };
  const choose = (id: string) => {
    if (id === selectedId && !composing) return;
    guard.confirm(() => {
      clearCompose();
      setSelectedId(id);
      setReadIds((ids) => new Set(ids).add(id));
      setReplying(false);
      setReply("");
      setDraftTitle(emails.find((m) => m.id === id)?.subject.slice(0, 200) ?? "");
      setDraftAddress("");
      setDraftPriority("Medium");
      setDraftDismissed(false);
      setLinkChoice("");
      setError("");
    });
  };
  const sync = async () => {
    if (locks.current.sync) return;
    locks.current.sync = true;
    setSyncing(true);
    setError("");
    try {
      const result = await syncGmail();
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["inbox"] });
        notify(`Synced ${result.count} emails from Gmail`);
      } else {
        if (result.code === "RECONNECT") setReconnect(true);
        setError(
          result.code === "RECONNECT"
            ? "Reconnect Gmail to update mailbox permissions."
            : "Could not sync Gmail. Press Sync to try again.",
        );
      }
    } catch {
      setError("Could not sync Gmail. Check your connection and try again.");
    } finally {
      locks.current.sync = false;
      setSyncing(false);
    }
  };
  const autoSynced = useRef(false);
  useEffect(() => {
    if (connected && !autoSynced.current) {
      autoSynced.current = true;
      void sync();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("gmail");
    if (!status) return;
    if (status === "connected") notify("Gmail connected");
    else
      setError(
        status === "denied"
          ? "Gmail connection was cancelled."
          : status === "different-account"
            ? "Disconnect the current mailbox before connecting a different Gmail account."
            : "Gmail connection failed. Please try again.",
      );
    window.history.replaceState(null, "", "/inbox");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sendFailure = (code: string) => {
    if (code === "RECONNECT") setReconnect(true);
    setError(
      code === "UNCERTAIN"
        ? "Delivery is not confirmed. Check Gmail Sent. Retrying the same draft safely checks the result; do not create a replacement message."
        : code === "RECONNECT"
          ? "Reconnect Gmail before sending. Your draft has been kept."
          : "Could not send this email. Your draft has been kept; please try again.",
    );
  };
  const composeSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locks.current.send) return;
    locks.current.send = true;
    setSending(true);
    setError("");
    try {
      const result = await sendEmail({
        data: {
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          requestId: requestId || null,
        },
      });
      if (result.ok) {
        guard.complete(() => {
          clearCompose();
          setFolder("sent");
          setSelectedId("");
          notify("Email sent");
        });
        await refresh();
      } else sendFailure(result.code);
    } catch {
      setError("Could not confirm delivery. Keep this draft and retry to check the result.");
    } finally {
      locks.current.send = false;
      setSending(false);
    }
  };
  const replySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || locks.current.send || !reply.trim()) return;
    locks.current.send = true;
    setSending(true);
    setError("");
    try {
      const result = await sendEmail({
        data: {
          to: selected.fromEmail,
          subject: /^re:/i.test(selected.subject) ? selected.subject : `Re: ${selected.subject}`,
          body: reply.trim(),
          requestId: selected.requestId,
          threadId: selected.threadId,
        },
      });
      if (result.ok) {
        guard.complete(() => {
          setReplying(false);
          setReply("");
          notify(`Reply sent to ${selected.fromName}`);
        });
        await refresh();
      } else sendFailure(result.code);
    } catch {
      setError("Could not confirm delivery. Keep this reply and retry to check the result.");
    } finally {
      locks.current.send = false;
      setSending(false);
    }
  };
  const moveSelected = async () => {
    if (!selected || locks.current.move) return;
    locks.current.move = true;
    setMoving(true);
    setError("");
    try {
      const result = await moveEmail({ data: { id: selected.id, trash: !selected.trashed } });
      if (result.ok) {
        notify(selected.trashed ? "Email restored" : "Email moved to Trash");
        setSelectedId("");
        await refresh();
      } else {
        if (result.code === "RECONNECT") setReconnect(true);
        setError(
          result.code === "RECONNECT"
            ? "Reconnect Gmail to allow moving mail to Trash."
            : "Could not move this email. Please try again.",
        );
      }
    } catch {
      setError("Could not move this email. Please try again.");
    } finally {
      locks.current.move = false;
      setMoving(false);
    }
  };
  const linkTo = async (id: string | null) => {
    if (!selected || locks.current.link) return;
    locks.current.link = true;
    setLinking(true);
    setError("");
    try {
      await linkEmail({ data: { emailId: selected.id, requestId: id } });
      await refresh();
      notify(id ? `Email linked to ${id}` : "Email unlinked");
    } catch {
      setError("Could not link this email. Your selection has been kept; try again.");
    } finally {
      locks.current.link = false;
      setLinking(false);
    }
  };
  const approveDraft = async () => {
    if (!selected || locks.current.create || (!pendingId && !draftTitle.trim())) return;
    locks.current.create = true;
    setCreating(true);
    setError("");
    let id = createdRef.current[selected.id];
    try {
      if (!id) {
        const created = await addRequest({
          title: draftTitle.trim(),
          address: draftAddress.trim() || "Address to be confirmed",
          priority: draftPriority,
        });
        id = created.id;
        createdRef.current = { ...createdRef.current, [selected.id]: id };
        setCreatedByEmail(createdRef.current);
      }
      await linkEmail({ data: { emailId: selected.id, requestId: id } });
      const next = { ...createdRef.current };
      delete next[selected.id];
      createdRef.current = next;
      setCreatedByEmail(next);
      await refresh();
      const target = id;
      guard.complete(() => {
        notify(`${target} created and linked to this email`);
        void navigate({ to: "/requests/$id", params: { id: target } });
      });
    } catch {
      setError(
        id
          ? `${id} was created, but the email link was not confirmed. Retry links this existing repair instead of creating another.`
          : "Could not confirm repair creation. Your draft has been kept. Check the repair list before retrying.",
      );
    } finally {
      locks.current.create = false;
      setCreating(false);
    }
  };
  const disconnect = async () => {
    if (locks.current.link) return;
    locks.current.link = true;
    setLinking(true);
    setError("");
    try {
      await disconnectGmail();
      setSelectedId("");
      await refresh();
      notify("Gmail disconnected");
    } catch {
      setError("Could not disconnect Gmail. Please try again.");
    } finally {
      locks.current.link = false;
      setLinking(false);
    }
  };
  return (
    <AppShell>
      {guard.confirmation}
      {error && !composing && !replying && (
        <div className="inbox-action-feedback">
          <ErrorState message={error} retry={() => void inbox.refetch()} />
        </div>
      )}
      <div className="inbox-layout">
        <section
          className={`inbox-list ${selected || composing ? "inbox-list-hidden" : ""}`}
          aria-label="Email list"
        >
          <div className="border-b">
            <div className="flex items-center justify-between">
              <h1>Inbox</h1>
              {connected && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Compose email"
                  title="Compose email"
                  onClick={() =>
                    guard.confirm(() => {
                      setSelectedId("");
                      clearCompose();
                      setComposing(true);
                    })
                  }
                >
                  <PenSquare className="h-4 w-4" />
                </Button>
              )}
            </div>
            {connected && (
              <>
                <nav aria-label="Mail folders" className="mail-folders">
                  {(["inbox", "sent", "trash"] as const).map((f) => (
                    <button
                      key={f}
                      aria-pressed={folder === f}
                      onClick={() =>
                        guard.confirm(() => {
                          setFolder(f);
                          setSelectedId("");
                          clearCompose();
                          setReplying(false);
                          setReply("");
                          setDraftAddress("");
                          setDraftPriority("Medium");
                        })
                      }
                    >
                      {f === "inbox" ? "Inbox" : f === "sent" ? "Sent" : "Trash"}
                    </button>
                  ))}
                </nav>
                <div className="mailbox-status">
                  <span title={mailbox}>{mailbox}</span>
                  <button
                    onClick={() => void sync()}
                    disabled={syncing}
                    title="Sync Gmail"
                    aria-label="Sync Gmail"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <p className="mail-sync-note">Up to 100 emails from the last 30 days.</p>
                {reconnect && (
                  <a href="/api/gmail/connect" className="reconnect-notice">
                    Reconnect Gmail — permission required
                  </a>
                )}
                <details className="mailbox-options">
                  <summary>Mailbox settings</summary>
                  <a href="/api/gmail/connect">Update Gmail permissions</a>
                  <button disabled={linking} onClick={() => guard.confirm(() => void disconnect())}>
                    Disconnect Gmail
                  </button>
                </details>
              </>
            )}
            <label className="inbox-search">
              <Search className="h-4 w-4" />
              <input
                aria-label="Search emails"
                placeholder="Search emails…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto">
            {inbox.isPending ? (
              <LoadingRows label="Loading inbox" />
            ) : inbox.isError ? (
              <div className="p-4">
                <ErrorState
                  message="Could not load your inbox."
                  retry={() => void inbox.refetch()}
                />
              </div>
            ) : !connected ? (
              <EmptyState
                title="Connect your mailbox"
                description="Bring tenant, landlord and tradesperson emails into one repair inbox."
                action={
                  <Button asChild>
                    <a href="/api/gmail/connect">
                      <Mail />
                      Connect Gmail
                    </a>
                  </Button>
                }
              />
            ) : list.length === 0 ? (
              <EmptyState
                search={Boolean(query)}
                title={query ? "No matching emails" : "No emails in this folder"}
                description={
                  query
                    ? "Try another search or clear the search field."
                    : "Press Sync to check for recent emails."
                }
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => (query ? setQuery("") : void sync())}
                  >
                    {query ? "Clear search" : syncing ? "Syncing…" : "Sync Gmail"}
                  </Button>
                }
              />
            ) : (
              list.map((m) => (
                <button
                  key={m.id}
                  className="email-preview"
                  aria-pressed={selectedId === m.id}
                  onClick={() => choose(m.id)}
                >
                  <div>
                    <strong
                      className={m.unread && !readIds.has(m.id) ? "font-semibold" : "font-normal"}
                    >
                      {folder === "sent" ? `To: ${m.toEmails}` : m.fromName}
                    </strong>
                    <time dateTime={new Date(m.receivedAt).toISOString()}>
                      {time(m.receivedAt)}
                    </time>
                  </div>
                  <h2>{m.subject}</h2>
                  <p>{m.snippet}</p>
                  <span className="email-repair-label">
                    {m.requestId ?? "Not linked to a repair"}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        {composing ? (
          <section className="compose-area">
            <Button
              variant="ghost"
              size="sm"
              className="inbox-back"
              onClick={() => guard.confirm(() => clearCompose())}
            >
              <ArrowLeft />
              Back to inbox
            </Button>
            <form
              className="compose-form surface form-stack"
              onSubmit={(e) => void composeSubmit(e)}
            >
              <h2>New email</h2>
              <p className="text-sm text-muted-foreground">
                Sent from your connected Gmail account after you select Send.
              </p>
              <fieldset disabled={sending} className="form-stack">
                <label>
                  To
                  <input
                    type="email"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="name@example.com"
                  />
                </label>
                <label>
                  Subject
                  <input
                    required
                    maxLength={998}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label>
                  Repair request
                  <select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                    <option value="">No repair link</option>
                    {requests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Message
                  <textarea
                    required
                    rows={10}
                    aria-label="Message"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
              </fieldset>
              {error && <ErrorState message={error} />}
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending}
                  onClick={() => guard.confirm(() => clearCompose())}
                >
                  Close draft
                </Button>
                <Button disabled={sending || !to.trim() || !subject.trim() || !body.trim()}>
                  {sending ? (
                    <PendingLabel>Sending…</PendingLabel>
                  ) : (
                    <>
                      <Send />
                      Send email
                    </>
                  )}
                </Button>
              </div>
            </form>
          </section>
        ) : selected ? (
          <section className="inbox-detail" aria-label="Selected email">
            <div className="inbox-message p-4 sm:p-6">
              <Button
                variant="ghost"
                size="sm"
                className="inbox-back mb-3"
                onClick={() =>
                  guard.confirm(() => {
                    setSelectedId("");
                    setReplying(false);
                    setReply("");
                    setDraftAddress("");
                    setDraftPriority("Medium");
                  })
                }
              >
                <ArrowLeft />
                Back to messages
              </Button>
              <article className="conversation-content">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  Original email · {new Date(selected.receivedAt).toLocaleString()}
                </div>
                <h2 className="mt-3 break-words">{selected.subject}</h2>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground break-all">
                    To: {selected.toEmails}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={moving}
                    onClick={() => guard.confirm(() => void moveSelected())}
                  >
                    {selected.trashed ? <Undo2 /> : <Trash2 />}
                    {moving ? "Moving…" : selected.trashed ? "Restore" : "Move to Trash"}
                  </Button>
                </div>
                <div className="email-sender">
                  <span>
                    {selected.fromName
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <div>
                    <strong>{selected.fromName}</strong>
                    <small>{selected.fromEmail}</small>
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words py-6">{selected.body}</p>
                {replying ? (
                  <form onSubmit={(e) => void replySubmit(e)} className="reply-form">
                    <label className="text-sm font-medium">
                      Reply to {selected.fromName}
                      <textarea
                        aria-label="Reply message"
                        autoFocus
                        required
                        disabled={sending}
                        rows={6}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        className="mt-2 block w-full"
                      />
                    </label>
                    {error && <ErrorState message={error} />}
                    <div className="form-actions">
                      <Button
                        variant="outline"
                        type="button"
                        disabled={sending}
                        onClick={() =>
                          guard.confirm(() => {
                            setReplying(false);
                            setReply("");
                          })
                        }
                      >
                        Cancel reply
                      </Button>
                      <Button disabled={sending || !reply.trim()}>
                        {sending ? (
                          <PendingLabel>Sending…</PendingLabel>
                        ) : (
                          <>
                            <Send />
                            Send reply
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setError("");
                      setReplying(true);
                    }}
                  >
                    <Reply />
                    Reply
                  </Button>
                )}
              </article>
            </div>
            <aside className="inbox-request border-t p-5" aria-label="Repair review">
              <div className="draft-heading">
                Repair review
                <span className="draft-label">
                  {selected.requestId ? "Linked" : "Review needed"}
                </span>
              </div>
              {selected.requestId ? (
                <div className="draft-form">
                  <span className="inline-flex items-center gap-2 text-xs text-done">
                    <CheckCircle2 className="h-4 w-4" />
                    Linked repair record
                  </span>
                  <Link
                    className="font-medium text-primary text-sm"
                    to="/requests/$id"
                    params={{ id: selected.requestId }}
                  >
                    {selected.requestId}
                    {linkedRequest ? ` — ${linkedRequest.title}` : ""}
                  </Link>
                  {linkedRequest && (
                    <>
                      <div>
                        <span className="draft-note">Property</span>
                        <p className="text-sm mt-1">{linkedRequest.address}</p>
                      </div>
                      <StatusLabel status={linkedRequest.column} />
                      <div>
                        <span className="draft-note">Next to act</span>
                        <p className="text-sm mt-1">{linkedRequest.waitingOn}</p>
                      </div>
                      <div>
                        <span className="draft-note">Current next action</span>
                        <p className="text-sm mt-1">{linkedRequest.nextAction}</p>
                      </div>
                    </>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to="/requests/$id" params={{ id: selected.requestId }}>
                      Open repair & AI review
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={linking}
                    onClick={() => void linkTo(null)}
                  >
                    Unlink email
                  </Button>
                </div>
              ) : pendingId ? (
                <div className="draft-form">
                  <p className="text-sm">
                    Repair{" "}
                    <Link to="/requests/$id" params={{ id: pendingId }} className="text-primary">
                      {pendingId}
                    </Link>{" "}
                    was created. Its email link needs confirmation.
                  </p>
                  <Button disabled={creating} onClick={() => void approveDraft()}>
                    {creating ? "Linking…" : "Retry linking existing repair"}
                  </Button>
                </div>
              ) : draftDismissed ? (
                <div className="draft-form">
                  <p className="draft-note">
                    Draft review is hidden. Dismissing it takes no additional action.
                  </p>
                  <Button variant="outline" onClick={() => setDraftDismissed(false)}>
                    Review draft
                  </Button>
                </div>
              ) : (
                <form
                  className="draft-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void approveDraft();
                  }}
                >
                  <p className="draft-note">
                    Email-based draft. These details are not AI-extracted or confirmed until you
                    review and create the repair.
                  </p>
                  <fieldset disabled={creating} className="form-stack">
                    <label>
                      Reported issue
                      <input
                        required
                        maxLength={200}
                        aria-label="Reported issue"
                        aria-describedby="draft-source"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                      />
                      <span id="draft-source" className="draft-note">
                        From the original email subject.
                      </span>
                    </label>
                    <label>
                      Property address
                      <input
                        maxLength={300}
                        placeholder="Confirm the property address"
                        value={draftAddress}
                        onChange={(e) => setDraftAddress(e.target.value)}
                      />
                    </label>
                    <label>
                      Priority
                      <select
                        aria-label="Priority"
                        value={draftPriority}
                        onChange={(e) => setDraftPriority(e.target.value as Priority)}
                      >
                        {["Urgent", "High", "Medium", "Low"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                  {!draftAddress.trim() && (
                    <p className="draft-missing">
                      Missing information: property address. You can create this repair as “Address
                      to be confirmed” and complete it during triage.
                    </p>
                  )}
                  <div className="draft-safety">
                    <strong>
                      <ShieldAlert className="inline h-3.5 w-3.5 mr-1" />
                      Safety review required
                    </strong>
                    No automated safety assessment is available here. Read the email and follow your
                    agency’s escalation process.
                  </div>
                  <div>
                    <span className="draft-note">Initial next action</span>
                    <p className="text-sm mt-1">Review request & assign trade</p>
                  </div>
                  <div className="draft-actions">
                    <Button disabled={creating || !draftTitle.trim()}>
                      {creating ? (
                        <PendingLabel>Creating repair…</PendingLabel>
                      ) : (
                        "Approve draft & create repair"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={creating}
                      onClick={() => setDraftDismissed(true)}
                    >
                      Dismiss draft
                    </Button>
                  </div>
                  <p className="draft-note">
                    Creates a repair using the existing workflow. No email is sent and no spending
                    is authorised.
                  </p>
                </form>
              )}
              {!selected.requestId &&
                !pendingId &&
                !draftDismissed &&
                requests.some((r) => r.column !== "Completed") && (
                  <div className="mt-6 border-t pt-4">
                    <label className="draft-note">
                      Or link to an existing repair
                      <select
                        aria-label="Link to existing repair"
                        className="mt-2 w-full"
                        value={linkChoice}
                        disabled={linking}
                        onChange={(e) => {
                          setLinkChoice(e.target.value);
                          if (e.target.value) void linkTo(e.target.value);
                        }}
                      >
                        <option value="">Choose repair…</option>
                        {requests
                          .filter((r) => r.column !== "Completed")
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.id} — {r.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    {error && linkChoice && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        disabled={linking}
                        onClick={() => void linkTo(linkChoice)}
                      >
                        Retry link
                      </Button>
                    )}
                  </div>
                )}
            </aside>
          </section>
        ) : (
          <div className="inbox-placeholder">
            <InboxIcon />
            <h2>{connected ? "Choose a conversation" : "Your repair conversations, together"}</h2>
            <p>
              {connected
                ? "Read the original email, review repair details, and decide the next step."
                : "Connect Gmail to review maintenance emails alongside their repair requests."}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
