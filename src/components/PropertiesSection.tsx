import { archiveProperty } from "@/lib/workflow-management.functions";
import { WorkflowDialog, button, primary } from "./case-workflow/CaseWorkflow";
import { PropertyContact } from "./case-workflow/PropertyContact";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Plus, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import {
  addProperty,
  updateProperty,
  deleteProperty,
  listProperties,
  listAppointments,
  listPropertyContactChanges,
  syncPropertyEventContacts,
} from "@/lib/workspace.functions";
const inputClass =
  "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring";
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full max-w-md sm:w-80">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none"
      />
    </div>
  );
}
export function PropertiesSection({
  selectedPropertyId = null,
  onSelectProperty,
}: { selectedPropertyId?: number | null; onSelectProperty?: (id: number | null) => void } = {}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{
    id: number;
    address: string;
    archived: boolean;
  } | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const { requests, notify } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: ["properties"], queryFn: () => listProperties() });
  const { data: contactChanges = [] } = useQuery({
    queryKey: ["property-contact-changes"],
    queryFn: () => listPropertyContactChanges(),
  });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [contactError, setContactError] = useState("");
  const empty = () => ({
    address: "",
    managerName: user?.name ?? "",
    managerEmail: user?.email ?? "",
    ownerName: "",
    ownerEmail: "",
    tenantName: "",
    tenantEmail: "",
    notes: "",
  });
  const { data: bookings = [] } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => listAppointments(),
  });
  const [query, setQuery] = useState("");
  const [selectedId, setSelected] = useState<number | null>(selectedPropertyId);
  useEffect(() => {
    setSelected(selectedPropertyId);
    setQuery("");
  }, [selectedPropertyId]);
  const setSelectedId = (id: number | null) => {
    setSelected(id);
    onSelectProperty?.(id);
  };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(empty);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["properties"] }),
      queryClient.invalidateQueries({ queryKey: ["requests"] }),
      queryClient.invalidateQueries({ queryKey: ["contacts"] }),
      queryClient.invalidateQueries({ queryKey: ["property-contact-changes"] }),
      queryClient.invalidateQueries({ queryKey: ["incident"] }),
    ]);
  const rows = data
    .filter((p) => selectedId === p.id || includeArchived || !p.archivedAt)
    .filter((p) => selectedId === null || p.id === selectedId)
    .filter((p) =>
      [
        p.address,
        p.managerName,
        p.ownerName,
        p.tenantName,
        p.managerEmail,
        p.ownerEmail,
        p.tenantEmail,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const unlinked = requests.filter((r) => !r.propertyId);
  return (
    <>
      {archiveTarget && (
        <WorkflowDialog
          title={archiveTarget.archived ? "Restore property" : "Archive property"}
          busy={archiveBusy}
          onClose={() => setArchiveTarget(null)}
        >
          <div className="space-y-4">
            <p>{archiveTarget.address}</p>
            <p>
              {archiveTarget.archived
                ? "Restore this property to the active list."
                : "Keep all event and contact history, but hide this property from new-event selection. Resolve or reassign open cases and cancel upcoming visits first."}
            </p>
            {archiveError && (
              <p role="alert" className="text-destructive">
                {archiveError}
              </p>
            )}
            <button
              className={primary}
              disabled={archiveBusy}
              onClick={async () => {
                setArchiveBusy(true);
                try {
                  await archiveProperty({
                    data: { id: archiveTarget.id, archive: !archiveTarget.archived },
                  });
                  await refresh();
                  setArchiveTarget(null);
                  notify("Property updated");
                } catch (e) {
                  setArchiveError(e instanceof Error ? e.message : "Could not update property");
                } finally {
                  setArchiveBusy(false);
                }
              }}
            >
              {archiveTarget.archived ? "Restore property" : "Confirm archive"}
            </button>
          </div>
        </WorkflowDialog>
      )}
      {selectedId !== null && (
        <button className="text-sm text-primary underline" onClick={() => setSelectedId(null)}>
          ← All properties
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />{" "}
          Include archived
        </label>
        <SearchBox value={query} onChange={setQuery} placeholder="Search properties or people…" />
        <button
          onClick={() => {
            setForm(empty());
            setEditing(null);
            setError("");
            setOpen(true);
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add property
        </button>
      </div>
      {open ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            setError("");
            try {
              if (editing) await updateProperty({ data: { ...form, id: editing } });
              else await addProperty({ data: form });
              setOpen(false);
              await refresh();
              notify(
                editing
                  ? "Property updated. Existing event contacts are preserved."
                  : "Property added",
              );
            } catch {
              setError("Could not save the property. Check the email addresses and try again.");
            } finally {
              setSaving(false);
            }
          }}
          className="space-y-4 rounded-lg border bg-card p-5 shadow-card"
        >
          <h2 className="font-semibold">{editing ? "Edit property" : "Add property"}</h2>
          <label className="block text-sm">
            Property address
            <input
              required
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                ["Property Manager", "managerName", "managerEmail"],
                ["Landlord", "ownerName", "ownerEmail"],
                ["Tenant", "tenantName", "tenantEmail"],
              ] as const
            ).map(([role, name, email]) => (
              <fieldset key={role} className="min-w-0 space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{role}</legend>
                <label className="block text-xs">
                  Name
                  <input
                    required={Boolean(form[email])}
                    value={form[name]}
                    onChange={(e) => setForm({ ...form, [name]: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs">
                  Email
                  <input
                    type="email"
                    required={Boolean(form[name])}
                    value={form[email]}
                    onChange={(e) => setForm({ ...form, [email]: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </fieldset>
            ))}
          </div>
          <label className="block text-sm">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 min-h-20 w-full rounded-md border bg-background p-3 text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            New events inherit these contacts. Updating people here does not replace contacts on
            historical events.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save property"}
            </button>
          </div>
        </form>
      ) : null}
      {unlinked.length ? (
        <div className="rounded-lg border border-attention/30 bg-attention-soft p-4 text-sm">
          <h2 className="font-medium">{unlinked.length} existing events need a property</h2>
          <p className="mt-1 text-muted-foreground">
            Open each event to select its property. Unclear address matches are not linked
            automatically.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {unlinked.map((r) => (
              <Link
                key={r.id}
                to="/requests/$id"
                params={{ id: r.id }}
                className="text-primary underline"
              >
                {r.id} · {r.title}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {isLoading ? <p>Loading properties…</p> : null}
      {isError ? (
        <p role="alert" className="text-destructive">
          Could not load properties.
        </p>
      ) : null}
      {!isLoading && !isError && !rows.length ? (
        <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {data.length
            ? "No matching properties."
            : "Add your first property, then create its events."}
        </p>
      ) : null}
      <div className="space-y-4">
        {rows.map((p) => {
          const events = requests.filter((r) => r.propertyId === p.id);
          const visits = bookings
            .filter((a) => a.propertyId === p.id)
            .sort((a, b) => a.startsAt - b.startsAt);
          const upcoming = visits.filter((a) => !a.cancelledAt && a.startsAt >= Date.now());
          const past = visits.filter((a) => a.cancelledAt || a.startsAt < Date.now());
          const activeEvents = events.filter((r) => r.column !== "Completed");
          const completedEvents = events.filter((r) => r.column === "Completed");
          const changes = contactChanges.filter((c) => c.propertyId === p.id);
          return (
            <article key={p.id} className="rounded-lg border bg-card p-5 shadow-card">
              {!p.archivedAt && (
                <div className="mb-4 rounded-lg border bg-muted/30 p-3 text-xs">
                  <strong>
                    Contact readiness ·{" "}
                    {
                      [
                        p.managerName && p.managerEmail,
                        p.ownerName && p.ownerEmail,
                        p.tenantName && p.tenantEmail,
                      ].filter(Boolean).length
                    }
                    /3 roles complete
                  </strong>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      { name: "PM", ready: p.managerName && p.managerEmail },
                      { name: "Landlord", ready: p.ownerName && p.ownerEmail },
                      { name: "Tenant", ready: p.tenantName && p.tenantEmail },
                    ]
                      .filter((r) => !r.ready)
                      .map((r) => (
                        <button
                          key={r.name}
                          className="rounded border px-2 py-1 text-primary"
                          onClick={() => {
                            setEditing(p.id);
                            setForm(p);
                            setError("");
                            setOpen(true);
                          }}
                        >
                          Complete {r.name} details →
                        </button>
                      ))}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Email actions need a named recipient and valid email. Existing case contacts are
                    reviewed separately.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Building2 className="h-4 w-4 shrink-0 text-primary" />
                    <button
                      className="text-left hover:text-primary"
                      onClick={() => {
                        setQuery("");
                        setSelectedId(p.id);
                      }}
                    >
                      {p.address} {p.archivedAt ? "· Archived" : ""}
                    </button>
                  </h2>
                  {p.notes ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {p.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    className={button}
                    onClick={async () => {
                      try {
                        const url = new URL("/workspace/properties", window.location.origin);
                        url.searchParams.set("property", String(p.id));
                        await navigator.clipboard.writeText(url.href);
                        notify("Property link copied. Sign-in is required to open it.");
                      } catch {
                        notify(
                          "Could not copy the link. Open the property and copy the address bar.",
                        );
                      }
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    className={button}
                    onClick={() => {
                      setArchiveTarget({
                        id: p.id,
                        address: p.address,
                        archived: Boolean(p.archivedAt),
                      });
                      setArchiveError("");
                    }}
                  >
                    {p.archivedAt ? "Restore" : "Archive"}
                  </button>
                  <button
                    className="rounded-md border px-3 py-1.5 text-xs"
                    onClick={() => {
                      setForm({
                        address: p.address,
                        managerName: p.managerName,
                        managerEmail: p.managerEmail,
                        ownerName: p.ownerName,
                        ownerEmail: p.ownerEmail,
                        tenantName: p.tenantName,
                        tenantEmail: p.tenantEmail,
                        notes: p.notes,
                      });
                      setEditing(p.id);
                      setOpen(true);
                      setError("");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    disabled={events.length > 0 || visits.length > 0}
                    aria-label={`Remove ${p.address}`}
                    className="rounded-md border p-1.5 text-muted-foreground disabled:opacity-30"
                    title={
                      events.length
                        ? "Properties with event history cannot be removed"
                        : "Remove property"
                    }
                    onClick={async () => {
                      try {
                        await deleteProperty({ data: { id: p.id } });
                        await refresh();
                        notify("Property removed");
                      } catch {
                        notify(
                          "This property could not be removed. Properties with events must be retained.",
                        );
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {selectedId === null ? (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span>
                    {activeEvents.length} active events · {upcoming.length} upcoming visits ·{" "}
                    {changes.length} contact updates
                  </span>
                  <button
                    className="rounded border px-3 py-2 text-primary"
                    onClick={() => {
                      setQuery("");
                      setSelectedId(p.id);
                    }}
                  >
                    View property
                  </button>
                </div>
              ) : (
                <>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    {[
                      ["PM", p.managerName, p.managerEmail],
                      ["Landlord", p.ownerName, p.ownerEmail],
                      ["Tenant", p.tenantName, p.tenantEmail],
                    ].map(([role, name, email]) => (
                      <div key={role} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{role}</dt>
                        <dd className="mt-1 break-words">
                          {name || "Not recorded"}
                          {email ? (
                            <>
                              <span className="block break-all text-xs text-primary">{email}</span>
                              <PropertyContact
                                propertyId={p.id}
                                email={email}
                                name={name ?? role ?? "Contact"}
                              />
                            </>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {changes.length > 0 ? (
                    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
                      <h3 className="font-medium">
                        Contact updates available · {changes.length} active events
                      </h3>
                      <p className="mt-1 text-muted-foreground">
                        Review before replacing an event’s PM, landlord and tenant. Completed events
                        keep their original contacts.
                      </p>
                      {changes.map((c) => (
                        <details key={c.requestId} className="mt-3 rounded border bg-card p-3">
                          <summary className="cursor-pointer font-medium">
                            Review contacts · {c.requestId}
                          </summary>
                          <div className="my-3 grid grid-cols-2 gap-4">
                            <div>
                              <strong>Event contacts</strong>
                              {c.current.map((person) => (
                                <p key={person.email}>
                                  {person.role} · {person.name} · {person.email}
                                </p>
                              ))}
                              {!c.current.length && <p>None recorded</p>}
                            </div>
                            <div>
                              <strong>Current property contacts</strong>
                              {c.next.map((person) => (
                                <p key={person.role}>
                                  {person.role} · {person.name} · {person.email}
                                </p>
                              ))}
                              {!c.next.length && (
                                <p>No contacts — existing event contacts will be removed.</p>
                              )}
                            </div>
                          </div>
                          <button
                            disabled={!!syncing}
                            className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
                            onClick={async () => {
                              setSyncing(c.requestId);
                              setContactError("");
                              try {
                                await syncPropertyEventContacts({
                                  data: { requestId: c.requestId, version: c.version },
                                });
                                await refresh();
                                notify(
                                  "Event contacts updated. Review its AI drafts before sending.",
                                );
                              } catch (e) {
                                setContactError(
                                  e instanceof Error ? e.message : "Could not update contacts.",
                                );
                              } finally {
                                setSyncing(null);
                              }
                            }}
                          >
                            {syncing === c.requestId ? "Updating…" : "Confirm contact update"}
                          </button>
                        </details>
                      ))}
                      {contactError && (
                        <p role="alert" className="mt-2 text-destructive">
                          {contactError}
                        </p>
                      )}
                    </div>
                  ) : null}
                  <div className="mt-4 border-t pt-3">
                    <h3 className="text-sm font-medium">
                      Events · {events.length} total ·{" "}
                      {events.filter((r) => r.column !== "Completed").length} active
                    </h3>
                    {events.length ? (
                      <div className="mt-2 space-y-2">
                        {activeEvents.map((r) => (
                          <Link
                            key={r.id}
                            to="/requests/$id"
                            params={{ id: r.id }}
                            className="flex flex-wrap justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm hover:bg-accent"
                          >
                            <span>
                              {r.id} · {r.title}
                            </span>
                            <span className="text-muted-foreground">{r.column}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No events linked yet.</p>
                    )}
                    {completedEvents.length > 0 && (
                      <details className="mt-3 rounded-md border p-3">
                        <summary className="cursor-pointer text-sm">
                          Completed events · {completedEvents.length}
                        </summary>
                        <div className="mt-2 space-y-2">
                          {completedEvents.map((r) => (
                            <Link
                              key={r.id}
                              to="/requests/$id"
                              params={{ id: r.id }}
                              className="block text-sm text-primary"
                            >
                              {r.id} · {r.title}
                            </Link>
                          ))}
                        </div>
                      </details>
                    )}
                    {!activeEvents.length && events.length > 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">No active events.</p>
                    )}
                    {visits.length ? (
                      <div className="mt-4">
                        <h3 className="text-sm font-medium">
                          Upcoming appointments · {upcoming.length}
                        </h3>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {upcoming.map((a) => (
                            <li key={a.id} className="break-words">
                              {a.title} {a.cancelledAt ? "· Cancelled" : ""} ·{" "}
                              {new Date(a.startsAt).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                        {!upcoming.length && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            No upcoming appointments.
                          </p>
                        )}
                        {past.length > 0 && (
                          <details className="mt-3 text-sm">
                            <summary className="cursor-pointer">
                              Past & cancelled appointments · {past.length}
                            </summary>
                            {past
                              .slice()
                              .reverse()
                              .map((a) => (
                                <p key={a.id} className="mt-2 text-muted-foreground">
                                  {a.title} {a.cancelledAt ? "· Cancelled" : ""} ·{" "}
                                  {new Date(a.startsAt).toLocaleString()}
                                </p>
                              ))}
                          </details>
                        )}
                      </div>
                    ) : null}
                    {!p.archivedAt && (
                      <Link
                        to="/"
                        search={{ property: p.id }}
                        className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create event for this property
                      </Link>
                    )}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
