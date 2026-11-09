import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listProperties } from "@/lib/workspace.functions";

export function PropertySelect({
  value,
  onChange,
  required = true,
}: {
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const inputId = useId();
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: ["properties"], queryFn: () => listProperties() });
  return (
    <div className="text-sm font-medium">
      <label htmlFor={inputId} className="block">
        Property
      </label>
      <select
        id={inputId}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading || isError}
        className="mt-1 h-10 w-full min-w-0 rounded-md border bg-card px-3 font-normal"
      >
        <option value="">{isLoading ? "Loading properties…" : "Choose a property…"}</option>
        {data.filter(p=>!p.archivedAt).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.address}
          </option>
        ))}
      </select>
      {isError ? (
        <span className="mt-1 block text-xs text-destructive">
          Could not load properties. Please refresh.
        </span>
      ) : null}
      {!isLoading && !isError && !data.length ? (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Add a property first in{" "}
          <Link
            to="/workspace/$section"
            params={{ section: "properties" }}
            className="text-primary underline"
          >
            Properties
          </Link>
          .
        </span>
      ) : null}
    </div>
  );
}
