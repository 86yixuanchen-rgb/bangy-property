import { useState } from "react";
import { X } from "lucide-react";
import { PropertySelect } from "./PropertySelect";
import type { Priority } from "@/lib/data";

export function CreateRequest({
  initialPropertyId,
  onClose,
  onSubmit,
}: {
  initialPropertyId?: number | undefined;
  onClose: () => void;
  onSubmit: (input: { title: string; propertyId: number; priority: Priority }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [title, setTitle] = useState("");
  const [propertyId, setPropertyId] = useState(initialPropertyId ? String(initialPropertyId) : "");
  const [priority, setPriority] = useState<Priority>("Medium");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setSaving(true);
          setSaveError("");
          try {
            await onSubmit({ title, propertyId: Number(propertyId), priority });
          } catch {
            setSaveError("Could not create the request. Please try again.");
          } finally {
            setSaving(false);
          }
        }}
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-float"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Create repair request</h2>
            <p className="text-sm text-muted-foreground">Add a new issue to the triage queue.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            Issue
            <input
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Leaking bathroom tap"
              className="mt-1 h-10 w-full rounded-md border px-3 font-normal outline-none focus:border-ring"
            />
          </label>
          <PropertySelect value={propertyId} onChange={setPropertyId} />
          <p className="text-xs text-muted-foreground">
            The property's PM, landlord and tenant will be added to this event.
          </p>
          <label className="block text-sm font-medium">
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="mt-1 h-10 w-full rounded-md border bg-card px-3 font-normal"
            >
              <option>Urgent</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
        </div>
        {saveError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {saveError}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={saving || !propertyId}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create request
          </button>
        </div>
      </form>
    </div>
  );
}
