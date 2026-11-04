import { useState } from "react";
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
export function PropertiesSection() {
  const { requests, notify } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: ["properties"], queryFn: () => listProperties() });
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
    ]);
  const rows = data.filter((p) =>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          const visits = bookings.filter((a) => a.propertyId === p.id);
          return (
            <article key={p.id} className="rounded-lg border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Building2 className="h-4 w-4 shrink-0 text-primary" />
                    {p.address}
                  </h2>
                  {p.notes ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {p.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
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
                        <a
                          href={`mailto:${email}`}
                          className="block break-all text-xs text-primary"
                        >
                          {email}
                        </a>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 border-t pt-3">
                <h3 className="text-sm font-medium">
                  Events · {events.length} total ·{" "}
                  {events.filter((r) => r.column !== "Completed").length} active
                </h3>
                {events.length ? (
                  <div className="mt-2 space-y-2">
                    {events.map((r) => (
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
                {visits.length ? (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium">Appointments · {visits.length}</h3>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {visits.map((a) => (
                        <li key={a.id} className="break-words">
                          {a.title} · {new Date(a.startsAt).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Link
                  to="/"
                  search={{ property: p.id }}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create event for this property
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
