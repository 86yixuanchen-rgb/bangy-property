import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Send,
  X,
  Plus,
  LoaderCircle,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { assistantActions, type AssistantResult } from "@/lib/assistant-actions";
import type { AssistantContext } from "@/lib/assistant-property";
import {
  listAssistantSessions,
  createAssistantSession,
  getAssistantConversation,
  askWorkspaceAssistant,
  createAssistantPlan,
  editAssistantStep,
  executeAssistantPlan,
  checkAssistantDelivery,
} from "@/lib/assistant-workspace.functions";
import { getCaseFile } from "@/lib/case-workflow.functions";
import { AssistantFields } from "./AssistantFields";
type Plan = Awaited<ReturnType<typeof getAssistantConversation>>["plans"][number];
const button = "rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50";
export function AssistantPanel({
  onClose,
  context,
  contextLabel,
}: {
  onClose: () => void;
  context?: AssistantContext | undefined;
  contextLabel?: string | undefined;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newAction, setNewAction] = useState("contact.save");
  const [newArgs, setNewArgs] = useState<Record<string, unknown>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [useContext, setUseContext] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const sessions = useQuery({
    queryKey: ["assistant-sessions", user?.email],
    queryFn: () => listAssistantSessions(),
  });
  const sessionId = selected ?? sessions.data?.[0]?.id;
  const chat = useQuery({
    queryKey: ["assistant-conversation", user?.email, sessionId],
    queryFn: () => getAssistantConversation({ data: { sessionId: sessionId! } }),
    enabled: Boolean(sessionId),
    refetchInterval: busy ? false : 10000,
  });
  const navigationSince = useRef(Date.now());
  const navigated = useRef(new Set<string>());
  useEffect(() => {
    const target = chat.data?.plans
      .flatMap((p) => p.steps)
      .find(
        (s) =>
          s.action === "workspace.open" &&
          s.state === "succeeded" &&
          (s.completedAt ?? 0) >= navigationSince.current &&
          !navigated.current.has(s.id),
      );
    if (!target?.result) return;
    const result = JSON.parse(target.result) as AssistantResult;
    if (result.href?.startsWith("/") && !result.href.startsWith("//")) {
      navigated.current.add(target.id);
      window.location.assign(result.href);
    }
  }, [chat.data]);
  const dirty = Object.keys(edits).length > 0 || (adding && Object.keys(newArgs).length > 0);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty || busy,
    withResolver: true,
    enableBeforeUnload: () => dirty || busy,
  });
  const pendingLeave = leave ?? (blocker.status === "blocked" ? blocker.proceed : null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.data?.messages.length, chat.data?.plans.length, busy]);
  async function refresh() {
    await qc.invalidateQueries();
  }
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      lock.current = false;
      setBusy(false);
      await refresh();
    }
  }
  async function ensureSession() {
    if (sessionId) return sessionId;
    const next = await createAssistantSession();
    setSelected(next.id);
    return next.id;
  }
  function navigateAway(fn: () => void) {
    if (busy) return;
    if (dirty) setLeave(() => fn);
    else fn?.();
  }
  useEffect(() => {
    const close = () => {
      if (busy) return;
      if (dirty) setLeave(() => onClose);
      else onClose();
    };
    window.addEventListener("assistant-close-request", close);
    return () => window.removeEventListener("assistant-close-request", close);
  }, [busy, dirty, onClose]);
  async function saveEdit(plan: Plan, stepId: string, args: Record<string, unknown>) {
    const latest = await getAssistantConversation({ data: { sessionId: plan.sessionId } });
    const p = latest.plans.find((p) => p.id === plan.id);
    if (!p) throw new Error("Plan no longer exists");
    await editAssistantStep({ data: { planId: p.id, stepId, revision: p.revision, args } });
    setEdits((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
  }
  async function addAction() {
    const id = await ensureSession();
    await createAssistantPlan({
      data: {
        sessionId: id,
        title: assistantActions[newAction]!.label,
        context: useContext ? (context ?? {}) : {},
        steps: [{ action: newAction, args: newArgs, dependsOn: [] }],
      },
    });
    setNewArgs({});
    setAdding(false);
  }
  async function saveAll() {
    for (const p of chat.data?.plans ?? [])
      for (const s of p.steps) if (edits[s.id]) await saveEdit(p, s.id, edits[s.id]!);
    if (adding && Object.keys(newArgs).length) await addAction();
  }
  async function ask(q: string) {
    if (!q.trim()) return;
    if (dirty) {
      setError("Save or discard the edited action before sending another instruction.");
      return;
    }
    navigationSince.current = Date.now();
    await run(async () => {
      const id = await ensureSession();
      await askWorkspaceAssistant({
        data: { sessionId: id, question: q, context: useContext ? (context ?? {}) : {} },
      });
      setInput("");
    });
  }
  async function download(id: string) {
    await run(async () => {
      const file = await getCaseFile({ data: { id } });
      const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const renderResult = (r: AssistantResult) => (
    <div className="mt-3 space-y-2 rounded bg-muted/60 p-3 text-xs text-foreground">
      <p>{r.summary}</p>
      {r.href ? (
        <a className="underline" href={r.href}>
          Open record →
        </a>
      ) : null}
      {r.fileId ? (
        <button className={button} onClick={() => void download(r.fileId!)}>
          Download file
        </button>
      ) : null}
      {r.rows?.map((row, i) => (
        <div key={i} className="rounded border bg-white p-2">
          <p className="font-medium">
            {String(
              row["address"] ??
                row["title"] ??
                row["name"] ??
                row["subject"] ??
                row["supplier"] ??
                row["id"] ??
                "Result",
            )}
          </p>
          {Object.entries(row)
            .filter(
              ([k, v]) =>
                !["userId", "href", "body", "content"].includes(k) &&
                v !== null &&
                typeof v !== "object",
            )
            .slice(0, 10)
            .map(([k, v]) => (
              <p key={k} className="break-words">
                {k}: {String(v)}
              </p>
            ))}
          {typeof row["href"] === "string" ? (
            <a className="underline" href={row["href"]}>
              Open →
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
  return (
    <aside
      className="fixed bottom-0 right-0 top-14 z-40 flex w-[480px] max-w-full shrink-0 flex-col border-l bg-card shadow-xl 2xl:static 2xl:z-auto"
      aria-label="Banjg AI assistant"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Bot className="h-5 w-5 text-ai" />
        <div className="flex-1">
          <div className="font-semibold">Banjg AI</div>
          <p className="text-xs text-muted-foreground">Plan, review and manage your workspace</p>
        </div>
        <button
          aria-label="Close AI assistant"
          disabled={busy}
          onClick={() => navigateAway(onClose)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-2 border-b px-3 py-2">
        <select
          aria-label="Conversation"
          className="min-w-0 flex-1 rounded border bg-card p-1.5 text-xs"
          value={sessionId ?? ""}
          disabled={busy}
          onChange={(e) =>
            navigateAway(() => {
              setSelected(e.target.value);
              setEdits({});
            })
          }
        >
          <option value="" disabled>
            New conversation
          </option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            navigateAway(
              () =>
                void run(async () => {
                  const s = await createAssistantSession();
                  setSelected(s.id);
                  setEdits({});
                  setAdding(false);
                }),
            )
          }
        >
          <Plus className="h-3 w-3" />
          <span className="sr-only">New conversation</span>
        </button>
      </div>
      {contextLabel ? (
        <label className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
          <input
            type="checkbox"
            checked={useContext}
            onChange={(e) => setUseContext(e.target.checked)}
          />
          {contextLabel}
          <span className="text-muted-foreground">For next message</span>
        </label>
      ) : null}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {chat.isError || sessions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load conversations.{" "}
            <button onClick={() => void refresh()} className="underline">
              Retry
            </button>
          </p>
        ) : null}
        {!chat.data?.messages.length && !chat.data?.plans.length ? (
          <div className="rounded-lg bg-muted/50 p-4 text-sm leading-6">
            <p className="font-medium">What would you like to get done?</p>
            <p className="mt-1 text-muted-foreground">
              Create a contact, link a property, book a repair, prepare emails or manage follow-ups.
              You can review every change here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["What needs my attention today?", "Show upcoming appointments"].map((q) => (
                <button className={button} key={q} onClick={() => void ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {chat.data?.messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-primary p-3 text-sm text-primary-foreground"
                : "mr-3 whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm"
            }
          >
            {m.content.startsWith('{"kind":"results"')
              ? renderResult(JSON.parse(m.content) as AssistantResult)
              : m.content}
          </div>
        ))}
        {chat.data?.plans.map((p) => (
          <section key={p.id} className="rounded-xl border bg-card shadow-sm">
            <div className="border-b bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{p.title}</strong>
                <span className="text-[10px] uppercase text-muted-foreground">{p.state}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {Object.entries(JSON.parse(p.context) as Record<string, unknown>)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ") || "Workspace"}{" "}
                · Original context retained
              </p>
            </div>
            <div className="space-y-3 p-3">
              {p.steps.map((s) => {
                const def = assistantActions[s.action]!;
                const stored = JSON.parse(s.args) as Record<string, unknown>;
                const args = edits[s.id] ?? stored;
                const editable =
                  ["pending", "failed"].includes(s.state) && p.state !== "superseded";
                const result = s.result ? (JSON.parse(s.result) as AssistantResult) : null;
                const deps = JSON.parse(s.dependsOn) as number[];
                const blocked = deps.some(
                  (n) => p.steps.find((x) => x.position === n)?.state !== "succeeded",
                );
                return (
                  <details
                    key={s.id}
                    open={editable || s.state === "succeeded" || s.state === "uncertain"}
                    className="rounded-lg border p-3"
                  >
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                      {s.state === "succeeded" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <span className="text-muted-foreground">{s.position}.</span>
                      )}
                      {def.label}
                      <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                        {s.state}
                      </span>
                      <ChevronDown className="h-3 w-3" />
                    </summary>
                    <p className="my-2 text-xs text-muted-foreground">{def.description}</p>
                    {deps.length ? (
                      <p className="mb-2 text-xs text-primary">After actions {deps.join(", ")}</p>
                    ) : null}
                    {s.state !== "succeeded" && (
                      <AssistantFields
                        fields={def.fields}
                        args={args}
                        disabled={busy || !editable}
                        onChange={(a) => setEdits((prev) => ({ ...prev, [s.id]: a }))}
                        references={p.steps
                          .filter((prev) => prev.position < s.position)
                          .flatMap((prev) => {
                            const output = (
                              {
                                "property.create": ["properties", "propertyId"],
                                "event.create": ["events", "requestId"],
                                "contact.save": ["contacts", "id"],
                                "appointment.create": ["appointments", "id"],
                                "quote.create": ["quotes", "id"],
                                "file.upload": ["files", "id"],
                                "email.draft": ["actions", "id"],
                              } as Record<string, string[]>
                            )[prev.action];
                            if (!output) return [];
                            const [entity, field] = output;
                            return [
                              {
                                value: `$${prev.position}.${field}`,
                                entity: entity!,
                                label: `Result of ${prev.position}. ${assistantActions[prev.action]!.label}`,
                              },
                            ];
                          })}
                      />
                    )}
                    {s.error ? (
                      <p role="alert" className="mt-2 break-words text-xs text-destructive">
                        {s.error}
                      </p>
                    ) : null}
                    {result ? renderResult(result) : null}
                    {s.action === "email.draft" && s.state === "succeeded" ? (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const actionId = result?.["actionId"];
                            const mailDraft = (result?.["draft"] ?? stored) as Record<
                              string,
                              unknown
                            >;
                            await createAssistantPlan({
                              data: {
                                sessionId: p.sessionId,
                                title: "Review email before sending",
                                context: JSON.parse(p.context),
                                steps: [
                                  {
                                    action: actionId ? "action.send" : "email.send",
                                    args: actionId
                                      ? {
                                          id: actionId,
                                          to: mailDraft["to"],
                                          subject: mailDraft["subject"],
                                          body: mailDraft["body"],
                                          attachmentIds: mailDraft["attachmentIds"] ?? [],
                                        }
                                      : mailDraft,
                                    dependsOn: [],
                                  },
                                ],
                              },
                            });
                          })
                        }
                      >
                        Review for sending
                      </button>
                    ) : null}
                    {editable ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => void run(() => saveEdit(p, s.id, args))}
                        >
                          {edits[s.id] ? "Save changes" : "Refresh & review"}
                        </button>
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await editAssistantStep({
                                data: {
                                  planId: p.id,
                                  stepId: s.id,
                                  revision: p.revision,
                                  cancel: true,
                                },
                              });
                              setEdits((prev) => {
                                const next = { ...prev };
                                delete next[s.id];
                                return next;
                              });
                            })
                          }
                        >
                          Skip
                        </button>
                        <button
                          disabled={busy || Boolean(edits[s.id]) || blocked}
                          className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
                          onClick={() =>
                            void run(async () => {
                              await executeAssistantPlan({
                                data: {
                                  planId: p.id,
                                  revision: p.revision,
                                  stepId: s.id,
                                  confirmation: def.confirm ?? "changes",
                                },
                              });
                            })
                          }
                        >
                          {def.confirm === "send"
                            ? "Confirm & send"
                            : def.confirm === "individual"
                              ? `Confirm ${def.label.toLowerCase()}`
                              : def.read
                                ? "Run query"
                                : "Confirm action"}
                        </button>
                      </div>
                    ) : null}
                    {s.state === "uncertain" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Automatic retry is disabled. Open the relevant record to verify the outcome.
                        {["email.send", "action.send"].includes(s.action) ? (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await checkAssistantDelivery({
                                  data: { planId: p.id, stepId: s.id },
                                });
                              })
                            }
                          >
                            Check delivery without resending
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                  </details>
                );
              })}
            </div>
            {p.steps.some(
              (s) =>
                ["pending", "failed"].includes(s.state) && !assistantActions[s.action]!.confirm,
            ) && p.state !== "superseded" ? (
              <div className="border-t p-3">
                <button
                  className={`${button} w-full`}
                  disabled={busy || Object.keys(edits).length > 0}
                  onClick={() =>
                    void run(async () => {
                      await executeAssistantPlan({
                        data: { planId: p.id, revision: p.revision, confirmation: "changes" },
                      });
                    })
                  }
                >
                  Confirm changes
                </button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Emails, cancellations, archiving and case closure need their own confirmation.
                </p>
              </div>
            ) : null}
          </section>
        ))}
        {adding ? (
          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">Prepare an action</h3>
            <select
              aria-label="Action type"
              className="w-full rounded border bg-card p-2 text-sm"
              value={newAction}
              onChange={(e) => {
                setNewAction(e.target.value);
                setNewArgs({});
              }}
            >
              {Object.entries(assistantActions).map(([key, d]) => (
                <option value={key} key={key}>
                  {d.label}
                </option>
              ))}
            </select>
            <AssistantFields
              fields={assistantActions[newAction]!.fields}
              args={newArgs}
              onChange={setNewArgs}
              disabled={busy}
            />
            <div className="flex gap-2">
              <button className={button} disabled={busy} onClick={() => void run(addAction)}>
                Save for review
              </button>
              <button
                className={button}
                onClick={() => {
                  setAdding(false);
                  setNewArgs({});
                }}
              >
                Discard
              </button>
            </div>
          </section>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Working on your request…
          </p>
        ) : null}
        <div ref={end} />
      </div>
      {error ? (
        <div role="alert" className="flex gap-2 border-t p-3 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}
      {pendingLeave ? (
        <div className="space-y-2 border-t bg-amber-50 p-4 text-sm">
          <p>Save your edited drafts before leaving?</p>
          <div className="flex gap-2">
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await saveAll();
                  const fn = pendingLeave;
                  setLeave(null);
                  fn?.();
                })
              }
            >
              Save & leave
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                setEdits({});
                setNewArgs({});
                setAdding(false);
                const fn = pendingLeave;
                setLeave(null);
                fn?.();
              }}
            >
              Discard
            </button>
            <button
              className={button}
              onClick={() => {
                setLeave(null);
                if (blocker.status === "blocked") blocker.reset();
              }}
            >
              Keep editing
            </button>
          </div>
        </div>
      ) : null}
      <div className="border-t p-3">
        <div className="mb-2 flex items-center justify-between">
          <button className={button} disabled={busy} onClick={() => setAdding((v) => !v)}>
            ＋ Add action
          </button>
          <span className="text-[10px] text-muted-foreground">Changes saved to this workspace</span>
        </div>
        <form
          className="flex gap-2 rounded-lg border bg-muted/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <textarea
            aria-label="Message Banjg AI"
            rows={2}
            placeholder="Tell AI what you want to do…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none"
          />
          <button
            aria-label="Send message"
            disabled={busy || !input.trim()}
            className="text-primary disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
