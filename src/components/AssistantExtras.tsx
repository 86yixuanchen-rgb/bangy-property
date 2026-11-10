import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  availableAppointmentSlots,
  inspectIncomingEmail,
  reconcileAssistantStep,
} from "@/lib/assistant-followthrough.functions";
import { saveDirectoryContact } from "@/lib/contacts.functions";
import { getCaseFile } from "@/lib/case-workflow.functions";
import { AssistantFields } from "./AssistantFields";
import { assistantActions } from "@/lib/assistant-actions";
const button = "rounded border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";
export function InlineContact({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false),
    [args, setArgs] = useState<Record<string, unknown>>({ role: "Tenant" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  if (!open)
    return (
      <button type="button" className={button} onClick={() => setOpen(true)}>
        Create missing contact
      </button>
    );
  return (
    <div className="space-y-2 rounded border bg-muted/30 p-3">
      <p className="font-medium">Create contact, then continue this action</p>
      <AssistantFields
        fields={assistantActions["contact.save"]!.fields.filter((f) => f.key !== "id")}
        args={args}
        onChange={setArgs}
        disabled={busy}
      />
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy}
        className={button}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await saveDirectoryContact({
              data: {
                name: String(args["name"] ?? ""),
                email: String(args["email"] ?? ""),
                role: args["role"] as "Tenant",
                phone: String(args["phone"] ?? ""),
                notes: String(args["notes"] ?? ""),
              },
            });
            await qc.invalidateQueries();
            onCreated(r.contact.id);
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save contact");
          } finally {
            setBusy(false);
          }
        }}
      >
        Confirm creation & select
      </button>
      <button type="button" className={button} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
export function FilePreview({ id }: { id: string }) {
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  return (
    <>
      <button
        type="button"
        className="underline"
        onClick={async () => {
          try {
            if (preview) {
              URL.revokeObjectURL(preview.url);
              setPreview(null);
              return;
            }
            const file = await getCaseFile({ data: { id } });
            const url = URL.createObjectURL(
              new Blob([Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))], {
                type: file.mime,
              }),
            );
            setPreview({ url, mime: file.mime });
          } catch {
            setError("Preview unavailable.");
          }
        }}
      >
        {preview ? "Close preview" : "Preview"}
      </button>
      {error && <span role="alert">{error}</span>}
      {preview &&
        (preview.mime === "application/pdf" ? (
          <iframe title="Case file preview" className="h-72 w-full" src={preview.url} />
        ) : (
          <img
            alt="Selected case attachment"
            className="max-h-72 object-contain"
            src={preview.url}
          />
        ))}
    </>
  );
}
export function AppointmentAlternatives({
  action,
  args,
  onSelect,
}: {
  action: string;
  args: Record<string, unknown>;
  onSelect: (args: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const valid =
    Number.isFinite(Number(args["startsAt"])) &&
    Number(args["endsAt"]) > Number(args["startsAt"]) &&
    (action === "appointment.update" ? Number(args["id"]) > 0 : Number(args["propertyId"]) > 0);
  const slots = useQuery({
    queryKey: ["appointment-slots", action, args],
    queryFn: () =>
      availableAppointmentSlots({
        data: {
          ...(action === "appointment.update"
            ? { appointmentId: Number(args["id"]) }
            : { propertyId: Number(args["propertyId"]) }),
          startsAt: Number(args["startsAt"]),
          endsAt: Number(args["endsAt"]),
          attendeeEmails: Array.isArray(args["attendeeEmails"])
            ? (args["attendeeEmails"] as string[])
            : [],
        },
      }),
    enabled: open && valid,
    retry: false,
  });
  return (
    <div className="space-y-2">
      <button type="button" disabled={!valid} className={button} onClick={() => setOpen(!open)}>
        Find available times
      </button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            Internal calendar · Sydney time · availability is checked again when saving.
          </p>
          {slots.isPending && <p>Checking availability…</p>}
          {slots.error && <p role="alert">{slots.error.message}</p>}
          {slots.data?.length === 0 && (
            <p>No available slots in the next 14 days. Change the date or duration.</p>
          )}
          {slots.data?.map((slot) => (
            <button
              type="button"
              key={slot.startsAt}
              className={`${button} block`}
              onClick={() => {
                onSelect({ ...args, ...slot });
                setOpen(false);
              }}
            >
              {new Date(slot.startsAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} –{" "}
              {new Date(slot.endsAt).toLocaleTimeString("en-AU", {
                timeZone: "Australia/Sydney",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
export function ActionEvidence({
  emailId,
  args,
}: {
  emailId: string;
  args: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const source = useQuery({
    queryKey: ["email-triage", emailId],
    queryFn: () => inspectIncomingEmail({ data: { emailId } }),
    enabled: open,
  });
  return (
    <details
      className="my-2 rounded border p-2 text-xs"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Source email & verification</summary>
      {source.data ? (
        <div className="space-y-2">
          <a className="underline" href={`/inbox?email=${encodeURIComponent(emailId)}`}>
            {source.data.email.subject} · {source.data.email.fromEmail}
          </a>
          <p>
            Direct text matches are evidence of wording, not confirmation of accuracy. Dates, roles
            and decisions require your review.
          </p>
          {Object.entries(args)
            .filter(
              ([k, v]) =>
                (typeof v === "string" || typeof v === "number") &&
                String(v).length > 0 &&
                !["id", "body", "threadId", "requestId", "emailId", "propertyId"].includes(k),
            )
            .map(([k, v]) => (
              <p key={k}>
                <strong>{k}:</strong>{" "}
                {["startsAt", "endsAt"].includes(k) && typeof v === "number"
                  ? new Date(v).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })
                  : String(v)}{" "}
                —{" "}
                {source.data!.email.body.toLowerCase().includes(String(v).toLowerCase()) ||
                source.data!.email.subject.toLowerCase().includes(String(v).toLowerCase())
                  ? "Appears in source text"
                  : "User / record value or AI interpretation — verify"}
              </p>
            ))}
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
            {source.data.email.body}
          </pre>
        </div>
      ) : (
        <p>{source.isError ? "Could not load source." : "Loading source…"}</p>
      )}
    </details>
  );
}
export function RecoverAction({
  stepId,
  action,
  onDone,
}: {
  stepId: string;
  action: string;
  onDone: () => Promise<void>;
}) {
  const [args, setArgs] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  const entity = (
    {
      "contact.save": "contacts",
      "property.update": "properties",
      "event.update": "events",
      "appointment.update": "appointments",
      "property.create": "properties",
      "event.create": "events",
      "appointment.create": "appointments",
      "email.draft": "actions",
    } as Record<string, string>
  )[action];
  const act = async (dismiss: boolean) => {
    setBusy(true);
    try {
      await reconcileAssistantStep({
        data: { stepId, dismiss, ...(args["id"] ? { recordId: String(args["id"]) } : {}) },
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded border p-2 text-xs">
      <p>Check the record first. This action will not be repeated automatically.</p>
      {entity && (
        <AssistantFields
          fields={[{ key: "id", label: "Existing result to verify", entity }]}
          args={args}
          onChange={setArgs}
          disabled={busy}
        />
      )}
      {entity && (
        <button className={button} disabled={busy || !args["id"]} onClick={() => void act(false)}>
          Verify existing result
        </button>
      )}
      <label className="flex gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I
        checked the outcome and do not want this step retried.
      </label>
      <button className={button} disabled={busy || !checked} onClick={() => void act(true)}>
        Dismiss this step
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
