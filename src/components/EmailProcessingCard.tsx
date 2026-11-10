import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { classifyEmail, inspectIncomingEmail } from "@/lib/assistant-followthrough.functions";
import {
  createAssistantSession,
  createAssistantPlan,
  askWorkspaceAssistant,
} from "@/lib/assistant-workspace.functions";
import { openAssistant } from "@/lib/assistant-open";
import { AssistantFields } from "./AssistantFields";
const button = "rounded border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50";
export function EmailProcessingCard({ emailId }: { emailId: string }) {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ["email-triage", emailId],
    queryFn: () => inspectIncomingEmail({ data: { emailId } }),
  });
  const [args, setArgs] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare review");
    } finally {
      setBusy(false);
    }
  };
  const d = info.data;
  if (!d)
    return (
      <p className="rounded border p-3 text-xs">
        {info.isError ? "Email processing unavailable." : "Checking property and event matches…"}
      </p>
    );
  const prepare = async (kind: "link" | "create" | "reply") => {
    const session = await createAssistantSession();
    openAssistant({
      sessionId: session.id,
      context: { emailId, ...(d.email.requestId ? { requestId: d.email.requestId } : {}) },
      label: d.email.subject,
    });
    if (kind === "reply") {
      await askWorkspaceAssistant({
        data: {
          sessionId: session.id,
          context: { emailId, requestId: d.email.requestId! },
          question:
            "Review this incoming reply. Summarise what changed and identify what is still unknown. Prepare separate editable actions for the next steps and email drafts. Quote approval must include matching quote amount and this landlord email as evidence for individual confirmation; do not assume approval from a reply alone. Do not send anything.",
        },
      });
    } else {
      const steps =
        kind === "link"
          ? [
              {
                action: "event.link_email",
                args: { emailId, requestId: args["requestId"] },
                dependsOn: [],
              },
            ]
          : [
              {
                action: "event.create",
                args: {
                  propertyId: Number(args["propertyId"]),
                  title: String(args["title"] ?? d.email.subject),
                  priority: "Medium",
                },
                dependsOn: [],
              },
              {
                action: "event.link_email",
                args: { emailId, requestId: "$1.requestId" },
                dependsOn: [1],
              },
            ];
      await createAssistantPlan({
        data: {
          sessionId: session.id,
          title: kind === "link" ? "Link incoming email" : "Create case from incoming email",
          context: { emailId },
          steps,
        },
      });
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      <div className="flex justify-between gap-2">
        <h3 className="font-semibold">
          {d.email.requestId ? "Reply → next steps" : "Process incoming email"}
        </h3>
        <span className="text-xs text-muted-foreground">{d.state.replaceAll("_", " ")}</span>
      </div>
      <p className="text-xs">
        Source: {d.email.fromName} · {d.email.fromEmail}
      </p>
      {d.extracted && (
        <p className="text-xs">
          Address found in text: <strong>{d.extracted}</strong> · Verify before linking.
        </p>
      )}
      {d.candidates.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={busy}
          onClick={() => setArgs((a) => ({ ...a, propertyId: p.id }))}
          className={`${button} mr-2 text-left`}
        >
          {p.address}
          <span className="block font-normal text-muted-foreground">
            {p.reason} · candidate only
          </span>
        </button>
      ))}
      {d.email.requestId ? (
        <>
          <a className="block text-xs underline" href={`/requests/${d.email.requestId}`}>
            Linked to {d.email.requestId} →
          </a>
          <p className="text-xs">
            Review the reply, confirm any decision, then prepare the next notices. No messages are
            sent here.
          </p>
          <button
            disabled={busy}
            className={button}
            onClick={() => void run(() => prepare("reply"))}
          >
            Summarise reply & prepare next steps
          </button>
        </>
      ) : d.state !== "not_repair" ? (
        <>
          <AssistantFields
            fields={[
              {
                key: "propertyId",
                label: "Property for a new case",
                entity: "properties",
                type: "number",
                optional: true,
              },
              { key: "title", label: "New case title", optional: true },
              {
                key: "requestId",
                label: "Existing case to link",
                entity: "events",
                optional: true,
              },
            ]}
            args={{ ...args, title: args["title"] ?? d.email.subject }}
            onChange={setArgs}
            disabled={busy}
          />
          {args["propertyId"] &&
          d.events.filter((e) => e.propertyId === Number(args["propertyId"])).length > 0 ? (
            <div className="rounded border border-amber-300 p-2 text-xs">
              Existing open cases at this property — check for duplicates:
              {d.events
                .filter((e) => e.propertyId === Number(args["propertyId"]))
                .map((e) => (
                  <button
                    key={e.id}
                    className="block underline"
                    onClick={() => setArgs((a) => ({ ...a, requestId: e.id }))}
                  >
                    {e.id} · {e.title}
                  </button>
                ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || !args["requestId"]}
              className={button}
              onClick={() => void run(() => prepare("link"))}
            >
              Review link to existing case
            </button>
            <button
              disabled={busy || !args["propertyId"]}
              className={button}
              onClick={() => void run(() => prepare("create"))}
            >
              Review new case
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs">
          Excluded from the repair review queue. The email remains in your inbox.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {d.state === "unreviewed" ? (
          <>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void run(async () => {
                  await classifyEmail({ data: { emailId, state: "not_repair" } });
                })
              }
            >
              Not a repair email
            </button>
            {d.email.requestId && (
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void run(async () => {
                    await classifyEmail({ data: { emailId, state: "reviewed" } });
                  })
                }
              >
                Mark reply reviewed
              </button>
            )}
          </>
        ) : (
          <button
            disabled={busy}
            className={button}
            onClick={() =>
              void run(async () => {
                await classifyEmail({ data: { emailId, state: "unreviewed" } });
              })
            }
          >
            Reopen review
          </button>
        )}
      </div>
      {busy && <p role="status">Preparing review — nothing has been sent…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
