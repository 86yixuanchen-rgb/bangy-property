import { useState } from "react";
import { InlineContact, FilePreview } from "./AssistantExtras";
import { timeDisplay, sydneyTimestamp } from "@/lib/appointment-time";
import { useQuery } from "@tanstack/react-query";
import { getAssistantOptions } from "@/lib/assistant-workspace.functions";
import type { Field } from "@/lib/assistant-actions";
const cls =
  "w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
function EntitySelect({
  field,
  value,
  onChange,
  disabled,
  refs,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  refs: { value: string; label: string; entity?: string }[];
}) {
  const [search, setSearch] = useState("");
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["assistant-options", field.entity],
    queryFn: () => getAssistantOptions({ data: { entity: field.entity! } }),
  });
  const filtered = data.filter((r) => r.label.toLowerCase().includes(search.toLowerCase()));
  if (field.type === "ids") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="space-y-2">
        <input
          aria-label={`Search ${field.label}`}
          placeholder="Search files…"
          className={cls}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p>{selected.length} / 5 selected</p>
        <div className="max-h-64 space-y-2 overflow-auto">
          {[
            ...filtered.filter((r) => !r.archived || selected.includes(r.id)),
            ...refs.map((r) => ({ id: r.value, label: r.label })),
          ].map((r) => (
            <div key={r.id} className="rounded border p-2">
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  disabled={disabled || (!selected.includes(r.id) && selected.length >= 5)}
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.label}
              </label>
              {!r.id.startsWith("$") && <FilePreview id={r.id} />}
            </div>
          ))}
        </div>
        {isError && <p role="alert">Could not load files.</p>}
      </div>
    );
  }
  const known = data.some((r) => r.id === String(value)) || refs.some((r) => r.value === value);
  return (
    <div className="space-y-2">
      <input
        aria-label={`Search ${field.label}`}
        placeholder={`Search ${field.label.toLowerCase()}…`}
        className={cls}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={field.label}
        className={cls}
        value={String(value ?? "")}
        disabled={disabled || isLoading}
        onChange={(e) =>
          onChange(
            e.target.value.startsWith("$")
              ? e.target.value
              : field.type === "number" && e.target.value
                ? Number(e.target.value)
                : e.target.value,
          )
        }
      >
        <option value="">{isLoading ? "Loading records…" : "Choose a record"}</option>
        {value && !known ? <option value={String(value)}>{String(value)}</option> : null}
        {data
          .filter((r) => filtered.includes(r) || r.id === String(value))
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.archived ? " (archived / cancelled)" : ""}
            </option>
          ))}
        {refs.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {isError && <p role="alert">Could not load records.</p>}
      {field.entity === "contacts" && !disabled && <InlineContact onCreated={onChange} />}
    </div>
  );
}
export function AssistantFields({
  fields,
  args,
  onChange,
  disabled = false,
  references = [],
}: {
  fields: Field[];
  args: Record<string, unknown>;
  onChange: (args: Record<string, unknown>) => void;
  disabled?: boolean;
  references?: { value: string; label: string; entity?: string }[];
}) {
  const set = (k: string, v: unknown) => onChange({ ...args, [k]: v });
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const value = args[field.key] ?? field.default ?? "";
        return (
          <div
            key={field.key}
            className={`block space-y-1 rounded text-xs text-muted-foreground ${!field.optional && field.default === undefined && (value === "" || value === null) ? "border-l-2 border-amber-400 pl-2" : ""}`}
          >
            <span>
              {field.label}
              {field.optional ? " (optional)" : ""}
            </span>
            {field.entity ? (
              <EntitySelect
                field={field}
                value={value}
                disabled={disabled}
                refs={references.filter((r) => !r.entity || r.entity === field.entity)}
                onChange={(v) => set(field.key, v)}
              />
            ) : field.type === "boolean" ? (
              <input
                aria-label={field.label}
                type="checkbox"
                checked={Boolean(value)}
                disabled={disabled}
                onChange={(e) => set(field.key, e.target.checked)}
              />
            ) : field.options ? (
              <select
                aria-label={field.label}
                className={cls}
                value={String(value)}
                disabled={disabled}
                onChange={(e) => set(field.key, e.target.value)}
              >
                <option value="">Choose…</option>
                {field.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : field.type === "file" ? (
              <>
                <input
                  aria-label={field.label}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1024 * 1024) {
                      e.target.setCustomValidity("Choose a file up to 1 MB");
                      e.target.reportValidity();
                      return;
                    }
                    e.target.setCustomValidity("");
                    const reader = new FileReader();
                    reader.onload = () =>
                      set(field.key, {
                        name: file.name,
                        mime: file.type,
                        content: String(reader.result).split(",")[1],
                      });
                    reader.readAsDataURL(file);
                  }}
                />
                {value && typeof value === "object" ? (
                  "name" in value ? (
                    <span className="block">Selected: {String(value.name)}</span>
                  ) : null
                ) : null}
              </>
            ) : field.type === "long" ? (
              <textarea
                aria-label={field.label}
                className={cls}
                rows={field.key === "body" ? 7 : 3}
                value={String(value)}
                disabled={disabled}
                onChange={(e) => set(field.key, e.target.value)}
              />
            ) : (
              <input
                aria-label={field.label}
                className={cls}
                disabled={disabled}
                type={
                  field.type === "time"
                    ? "datetime-local"
                    : field.type === "number"
                      ? "number"
                      : "text"
                }
                step={field.type === "number" ? "any" : undefined}
                value={
                  field.type === "time"
                    ? timeDisplay(value)
                    : Array.isArray(value)
                      ? value.join(", ")
                      : String(value)
                }
                onChange={(e) => {
                  try {
                    const raw = e.target.value;
                    set(
                      field.key,
                      field.type === "time"
                        ? sydneyTimestamp(raw)
                        : field.type === "number" && raw
                          ? Number(raw)
                          : field.type === "emails" || field.type === "ids"
                            ? raw
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean)
                            : raw,
                    );
                    e.target.setCustomValidity("");
                  } catch (err) {
                    e.target.setCustomValidity(err instanceof Error ? err.message : "Invalid time");
                    e.target.reportValidity();
                  }
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
