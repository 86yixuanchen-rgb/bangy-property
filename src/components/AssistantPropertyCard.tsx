import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, CheckCircle2 } from "lucide-react";
import type { AssistantPropertyDraft } from "@/lib/assistant-property";
import { confirmAssistantProperty } from "@/lib/assistant-property.functions";
import { linkProperty } from "@/lib/requests.functions";
import { useAuth } from "@/lib/auth";

export function AssistantPropertyCard({ draft }: { draft: AssistantPropertyDraft }) {
  const { user } = useAuth();
  const [fields, setFields] = useState(() => ({
    ...draft.fields,
    ...(!draft.fields.managerEmail && user?.email
      ? { managerName: user.name, managerEmail: user.email }
      : {}),
  }));
  const [result, setResult] = useState<Awaited<ReturnType<typeof confirmAssistantProperty>> | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [linked, setLinked] = useState(false),
    [cancelled, setCancelled] = useState(false);
  const inFlight = useRef(false);
  const client = useQueryClient();
  const refresh = () =>
    Promise.all(
      ["properties", "requests", "contacts", "incident", "property-contact-changes"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const field = "mt-1 block w-full rounded border bg-background p-2 text-sm";
  if (cancelled)
    return (
      <p className="rounded border p-3 text-sm text-muted-foreground">
        Property creation cancelled. No records were changed.
      </p>
    );
  return (
    <section
      className="rounded-lg border bg-card p-3 text-sm"
      aria-label="Property creation review"
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Building2 size={16} />
        {result ? "Property available" : "Review property details"}
      </h3>
      <p className="mb-3 break-words text-xs text-muted-foreground">Source: {draft.source}</p>
      {result ? (
        <div className="space-y-3">
          <p role="status" className="flex items-start gap-2 text-done">
            <CheckCircle2 size={18} />
            {result.created
              ? "Property created successfully."
              : "This address already exists. The existing property was reused; its contacts were not changed."}
          </p>
          <p className="font-medium">{result.property.address}</p>
          <Link
            to="/workspace/$section"
            params={{ section: "properties" }}
            search={{ property: result.property.id }}
            className="block text-primary underline"
          >
            Open property
          </Link>
          {draft.canLink &&
            draft.requestId &&
            (linked ? (
              <p role="status">
                Linked to {draft.requestId}. Property contacts are now available on the event.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  The event has not been linked yet. Linking brings in the property’s recorded
                  contacts.
                </p>
                <button
                  disabled={busy}
                  className="w-full rounded border px-3 py-2 disabled:opacity-50"
                  onClick={async () => {
                    if (inFlight.current) return;
                    inFlight.current = true;
                    setBusy(true);
                    setError("");
                    try {
                      await linkProperty({
                        data: { requestId: draft.requestId!, propertyId: result.property.id },
                      });
                      setLinked(true);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not link the event.");
                    } finally {
                      setBusy(false);
                      inFlight.current = false;
                    }
                  }}
                >
                  {busy ? "Linking…" : `Link to ${draft.requestId}`}
                </button>
              </>
            ))}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError("");
            try {
              const saved = await confirmAssistantProperty({
                data: { fields, sourceEmailId: draft.sourceEmailId, requestId: draft.requestId },
              });
              setResult(saved);
              await refresh();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not create the property. Your details are still here.",
              );
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        >
          <p className="text-xs text-muted-foreground">
            Check the address. Contacts are optional; leave unknown people blank. The email sender
            is not automatically treated as the tenant.
          </p>
          <label className="block">
            Property address
            <input
              required
              maxLength={300}
              className={field}
              disabled={busy}
              value={fields.address}
              onChange={(e) => setFields({ ...fields, address: e.target.value })}
            />
          </label>
          <details>
            <summary className="cursor-pointer text-primary">PM, landlord & tenant details</summary>
            <div className="mt-3 space-y-3">
              {[
                ["Property Manager", "managerName", "managerEmail"],
                ["Landlord", "ownerName", "ownerEmail"],
                ["Tenant", "tenantName", "tenantEmail"],
              ].map(([role, name, email]) => {
                const nameKey = name as "managerName" | "ownerName" | "tenantName",
                  emailKey = email as "managerEmail" | "ownerEmail" | "tenantEmail";
                return (
                  <fieldset key={role} className="rounded border p-2">
                    <legend className="px-1 text-xs font-medium">{role}</legend>
                    <label className="block text-xs">
                      {role} name
                      <input
                        className={field}
                        disabled={busy}
                        maxLength={100}
                        required={!!fields[emailKey]}
                        value={fields[nameKey]}
                        onChange={(e) => setFields({ ...fields, [nameKey]: e.target.value })}
                      />
                    </label>
                    <label className="mt-2 block text-xs">
                      {role} email
                      <input
                        type="email"
                        className={field}
                        disabled={busy}
                        maxLength={200}
                        required={!!fields[nameKey]}
                        value={fields[emailKey]}
                        onChange={(e) => setFields({ ...fields, [emailKey]: e.target.value })}
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
          </details>
          <label className="block">
            Notes
            <textarea
              className={field}
              maxLength={1000}
              disabled={busy}
              value={fields.notes}
              onChange={(e) => setFields({ ...fields, notes: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Confirmation creates the property record. It does not send an email or automatically
            link an event.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded border px-3 py-2"
              onClick={() => setCancelled(true)}
            >
              Cancel
            </button>
            <button
              disabled={busy || !fields.address.trim()}
              className="flex-1 rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Creating…" : "Confirm create property"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
