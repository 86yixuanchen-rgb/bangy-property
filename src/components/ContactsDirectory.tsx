import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listContacts } from "@/lib/workspace.functions";
import {
  listDirectoryContacts,
  saveDirectoryContact,
  archiveDirectoryContact,
  associateContact,
} from "@/lib/contacts.functions";
import { AssistantFields } from "./AssistantFields";
import { assistantActions } from "@/lib/assistant-actions";
const btn = "rounded border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50";
export function ContactsDirectory() {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery({ queryKey: ["contacts"], queryFn: () => listContacts() });
  const { data: directory = [] } = useQuery({
    queryKey: ["directory-contacts"],
    queryFn: () => listDirectoryContacts(),
  });
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [association, setAssociation] = useState<Record<string, unknown> | null>(null);
  const [archive, setArchive] = useState<{ id: string; archive: boolean; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save contact");
    } finally {
      setBusy(false);
    }
  }
  const merged = people
    .filter((p) => !directory.some((c) => c.email === p.email && c.archivedAt))
    .map((p) => ({ ...p, profile: directory.find((c) => c.email === p.email) }));
  for (const c of directory.filter((c) => !c.archivedAt))
    if (!merged.some((p) => p.email === c.email))
      merged.push({
        name: c.name,
        email: c.email,
        roles: [c.role],
        requests: [],
        emails: 0,
        profile: c,
      });
  const rows = (
    showArchived
      ? directory
          .filter((c) => c.archivedAt)
          .map((c) => ({
            name: c.name,
            email: c.email,
            roles: [c.role],
            requests: [] as string[],
            emails: 0,
            profile: c,
          }))
      : merged
  ).filter((c) =>
    `${c.name} ${c.email} ${c.roles.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          aria-label="Search contacts"
          placeholder="Search contacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 flex-1 rounded border bg-card px-3 text-sm"
        />
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
        <button
          className={`${btn} bg-primary text-primary-foreground`}
          onClick={() => setForm({ name: "", email: "", role: "Tenant", phone: "", notes: "" })}
        >
          New contact
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {form ? (
        <form
          className="max-w-xl space-y-3 rounded-lg border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await saveDirectoryContact({
                data: form as Parameters<typeof saveDirectoryContact>[0]["data"],
              });
              setForm(null);
            });
          }}
        >
          <h2 className="font-semibold">
            {form["id"] ? "Edit contact" : "Create contact profile"}
          </h2>
          <AssistantFields
            fields={assistantActions["contact.save"]!.fields.filter((f) => f.key !== "id")}
            args={form}
            onChange={setForm}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Profile changes preserve historical event and property contacts. Use Associate to update
            a relationship.
          </p>
          <div className="flex gap-2">
            <button className={btn} disabled={busy}>
              Save contact
            </button>
            <button className={btn} type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {association ? (
        <form
          className="max-w-xl space-y-3 rounded-lg border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const data = { ...association };
              if (!data["propertyId"]) delete data["propertyId"];
              if (!data["requestId"]) delete data["requestId"];
              await associateContact({
                data: data as Parameters<typeof associateContact>[0]["data"],
              });
              setAssociation(null);
            });
          }}
        >
          <h2 className="font-semibold">Associate contact</h2>
          <p className="text-xs text-muted-foreground">
            Choose one property or event. A property role replaces the current contact for that
            role.
          </p>
          <AssistantFields
            fields={assistantActions["contact.associate"]!.fields.filter((f) => f.key !== "id")}
            args={association}
            onChange={setAssociation}
            disabled={busy}
          />
          <button className={btn} disabled={busy}>
            Confirm association
          </button>{" "}
          <button type="button" className={btn} onClick={() => setAssociation(null)}>
            Cancel
          </button>
        </form>
      ) : null}
      {archive ? (
        <div role="alertdialog" className="space-y-3 rounded-lg border bg-card p-4">
          <p>
            {archive.archive ? "Archive" : "Restore"} {archive.name}? Historical records remain
            available.
          </p>
          <button
            className={btn}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await archiveDirectoryContact({
                  data: { id: archive.id, archive: archive.archive },
                });
                setArchive(null);
              })
            }
          >
            Confirm
          </button>{" "}
          <button className={btn} onClick={() => setArchive(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border bg-card">
        {!rows.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No matching contacts. Create a profile to get started.
          </p>
        ) : (
          rows.map((c) => (
            <div key={c.email} className="flex items-center gap-4 border-b p-4 last:border-0">
              <div className="min-w-0 flex-1">
                <strong className="text-sm">{c.profile?.name ?? c.name}</strong>
                <p className="text-xs text-muted-foreground">
                  {c.email} · {c.roles.join(", ")}
                  {c.profile?.phone ? ` · ${c.profile.phone}` : ""}
                </p>
                <div className="mt-1 flex gap-2">
                  {c.requests.map((id) => (
                    <Link
                      to="/requests/$id"
                      params={{ id }}
                      key={id}
                      className="text-xs text-primary"
                    >
                      {id}
                    </Link>
                  ))}
                </div>
              </div>
              {c.profile?.archivedAt ? (
                <button
                  className={btn}
                  onClick={() => setArchive({ id: c.profile!.id, name: c.name, archive: false })}
                >
                  Restore
                </button>
              ) : (
                <>
                  <button
                    className={btn}
                    onClick={() =>
                      setForm(
                        c.profile
                          ? { ...c.profile }
                          : {
                              name: c.name,
                              email: c.email,
                              role: c.roles[0] ?? "Other",
                              phone: "",
                              notes: "",
                            },
                      )
                    }
                  >
                    {c.profile ? "Edit" : "Create profile"}
                  </button>
                  {c.profile ? (
                    <>
                      <button
                        className={btn}
                        onClick={() =>
                          setAssociation({
                            id: c.profile!.id,
                            role: c.profile!.role === "Other" ? "Tenant" : c.profile!.role,
                          })
                        }
                      >
                        Associate
                      </button>
                      <button
                        className={btn}
                        onClick={() =>
                          setArchive({ id: c.profile!.id, name: c.name, archive: true })
                        }
                      >
                        Archive
                      </button>
                    </>
                  ) : null}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
