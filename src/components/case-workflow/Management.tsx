import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelVisit,
  reviseQuote,
  updateCaseFile,
  previewPropertyCorrection,
  correctProperty,
} from "@/lib/workflow-management.functions";
import { getCaseRecords } from "@/lib/case-workflow.functions";
import { PropertySelect } from "@/components/PropertySelect";
import {
  WorkflowDialog,
  field,
  button,
  primary,
  useWorkflowRefresh,
  type Incident,
} from "./CaseWorkflow";
export function CancelVisit({
  appointment,
  onChanged,
}: {
  appointment: {
    id: number;
    title: string;
    startsAt: number;
    cancelledAt?: number | null;
    requestId?: string | null;
  };
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  if (appointment.cancelledAt)
    return <span className="text-xs text-muted-foreground">Cancelled · history retained</span>;
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        Cancel visit
      </button>
      {open && (
        <WorkflowDialog title="Cancel appointment" busy={busy} onClose={() => setOpen(false)}>
          <p>
            {appointment.title} · {new Date(appointment.startsAt).toLocaleString()}
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await cancelVisit({ data: { id: appointment.id, reason } });
                await onChanged();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Cancellation failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Why is this visit cancelled?
              <textarea
                required
                minLength={3}
                maxLength={1000}
                className={field}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              The appointment stays in history. For event visits, notification drafts are prepared
              for the tenant and repair team. Review each draft before sending.
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button className={primary} disabled={busy}>
              {busy ? "Saving…" : "Confirm cancellation"}
            </button>
          </form>
        </WorkflowDialog>
      )}
    </>
  );
}
export function ReviseQuote({
  quote,
  requestId,
}: {
  quote: Incident["quotes"][number];
  requestId: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    supplier: quote.supplier,
    amount: String(quote.amount),
    description: quote.description,
    reason: "",
  });
  const refresh = useWorkflowRefresh(requestId);
  if (quote.supersededAt)
    return <span className="text-xs text-muted-foreground">Superseded · history retained</span>;
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        Revise quote
      </button>
      {open && (
        <WorkflowDialog title="Create revised quote" busy={busy} onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm">
            Quote #{quote.id} · ${quote.amount.toFixed(2)} · {quote.status}. This version remains in
            history. The replacement needs a new decision.
          </p>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await reviseQuote({ data: { id: quote.id, ...form, amount: Number(form.amount) } });
                await refresh();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not revise quote");
              } finally {
                setBusy(false);
              }
            }}
          >
            {(
              [
                ["supplier", "Supplier"],
                ["amount", "New amount ($)"],
                ["description", "Description"],
                ["reason", "Reason for revision"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                {label}
                <input
                  required={key !== "description"}
                  type={key === "amount" ? "number" : "text"}
                  min={key === "amount" ? "0.01" : undefined}
                  step={key === "amount" ? "0.01" : undefined}
                  minLength={key === "reason" ? 3 : undefined}
                  className={field}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button className={primary} disabled={busy}>
              {busy ? "Saving…" : "Save new pending version"}
            </button>
          </form>
        </WorkflowDialog>
      )}
    </>
  );
}
type File = Awaited<ReturnType<typeof getCaseRecords>>["files"][number];
export function FileManagement({
  file,
  requestId,
  quotes,
}: {
  file: File;
  requestId: string;
  quotes: Incident["quotes"];
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [name, setName] = useState(file.name),
    [category, setCategory] = useState(file.category),
    [quoteId, setQuoteId] = useState(file.quoteId ? String(file.quoteId) : "");
  const refresh = useWorkflowRefresh(requestId);
  const save = async (trash: boolean) => {
    setBusy(true);
    setError("");
    try {
      await updateCaseFile({
        data: {
          id: file.id,
          name,
          category: category as "Quote",
          quoteId: quoteId ? Number(quoteId) : null,
          trash,
        },
      });
      await refresh();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update file");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        {file.trashedAt ? "Restore / details" : "Manage file"}
      </button>
      {open && (
        <WorkflowDialog title="Manage case file" busy={busy} onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <label className="block">
              Filename
              <input
                required
                maxLength={200}
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              Category
              <select
                className={field}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {["Damage photo", "Quote", "Completion photo", "Other"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Associated quote
              <select
                className={field}
                value={quoteId}
                onChange={(e) => setQuoteId(e.target.value)}
              >
                <option value="">No specific quote</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    #{q.id} · {q.supplier} · ${q.amount.toFixed(2)}
                    {q.supersededAt ? " · superseded" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              Files moved to the recycle bin can be restored. Previously sent attachments remain
              unchanged.
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button className={primary} disabled={busy}>
                {file.trashedAt ? "Restore file" : "Save changes"}
              </button>
              {!file.trashedAt && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  Move to recycle bin
                </button>
              )}
            </div>
          </form>
        </WorkflowDialog>
      )}
    </>
  );
}
export function AttachmentPicker({
  requestId,
  value,
  onChange,
  disabled = false,
}: {
  requestId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: ["case-records", requestId],
    queryFn: () => getCaseRecords({ data: { requestId: requestId! } }),
    enabled: !!requestId,
  });
  if (!requestId) return null;
  const files = (query.data?.files ?? []).filter((f) => !f.trashedAt || value.includes(f.id));
  return (
    <fieldset className="rounded border p-3 text-sm">
      <legend className="px-1 font-medium">Attachments · {value.length} selected</legend>
      <p className="mb-2 text-muted-foreground">
        Only checked files will be sent. Up to five files.
      </p>
      {query.isPending ? (
        <p>Loading case files…</p>
      ) : query.isError ? (
        <p role="alert">Could not load attachments. Refresh before sending.</p>
      ) : files.length ? (
        files.map((f) => (
          <label key={f.id} className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={value.includes(f.id)}
              disabled={disabled || !!f.trashedAt || (!value.includes(f.id) && value.length >= 5)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, f.id] : value.filter((id) => id !== f.id))
              }
            />
            <span>
              {f.name} · {Math.ceil(f.size / 1024)} KB
              {f.trashedAt ? " · in recycle bin (remove or restore before sending)" : ""}
            </span>
            {f.trashedAt && !disabled && (
              <button
                type="button"
                className="underline"
                onClick={() => onChange(value.filter((id) => id !== f.id))}
              >
                Remove
              </button>
            )}
          </label>
        ))
      ) : (
        <p className="text-muted-foreground">
          No files available. Upload files in the event’s Case files section.
        </p>
      )}
    </fieldset>
  );
}
export function CorrectProperty({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false),
    [propertyId, setPropertyId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewPropertyCorrection>
  > | null>(null);
  const refresh = useWorkflowRefresh(requestId);
  const client = useQueryClient();
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        Correct property
      </button>
      {open && (
        <WorkflowDialog title="Correct event property" busy={busy} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <PropertySelect
              value={propertyId}
              onChange={(v) => {
                setPropertyId(v);
                setPreview(null);
                setConfirmed(false);
              }}
            />
            <button
              className={button}
              disabled={!propertyId || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setPreview(
                    await previewPropertyCorrection({
                      data: { requestId, propertyId: Number(propertyId) },
                    }),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not load impact");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Review impact
            </button>
            {preview && (
              <>
                <p>
                  <strong>{preview.from}</strong> → <strong>{preview.target.address}</strong>
                </p>
                <div className="grid grid-cols-2 gap-3 rounded border p-3 text-sm">
                  <div>
                    <strong>Current people</strong>
                    {preview.currentPeople.map((p) => (
                      <p key={p.email}>
                        {p.role} · {p.name} · {p.email}
                      </p>
                    ))}
                  </div>
                  <div>
                    <strong>Replacement people</strong>
                    {preview.newPeople.map((p) => (
                      <p key={p.role}>
                        {p.role} · {p.name} · {p.email}
                      </p>
                    ))}
                  </div>
                </div>
                <p className="text-sm">
                  {preview.appointments} appointment(s) will follow this property. {preview.drafts}{" "}
                  unsent draft(s) will be withdrawn. {preview.quotes} quote(s) will remain as
                  superseded history and require new versions. {preview.files} files and all
                  messages stay with the event. Sent emails are not changed.
                </p>
                {preview.sending && (
                  <p className="text-destructive">
                    Resolve uncertain deliveries before proceeding.
                  </p>
                )}
                <label className="block">
                  Reason
                  <textarea
                    required
                    minLength={3}
                    className={field}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I reviewed the affected contacts, appointments and drafts.
                </label>
                <button
                  className={primary}
                  disabled={busy || !confirmed || reason.trim().length < 3 || preview.sending}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await correctProperty({
                        data: {
                          requestId,
                          propertyId: Number(propertyId),
                          version: preview.version,
                          targetVersion: JSON.stringify(preview.target),
                          reason,
                        },
                      });
                      await refresh();
                      await client.invalidateQueries({ queryKey: ["property-contact-changes"] });
                      setOpen(false);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Correction failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm property correction
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        </WorkflowDialog>
      )}
    </>
  );
}
