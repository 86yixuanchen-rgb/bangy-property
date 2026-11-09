import { listWaitingCases } from "@/lib/workflow-management.functions";
import { useQuery } from "@tanstack/react-query";
import { listFollowUps } from "@/lib/case-workflow.functions";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { columns, priorityTone, type Priority, type RepairRequest } from "@/lib/data";
import { RequestCard } from "@/components/RequestCard";

type Property = { id: number; address: string };
export function RepairWorkspace({
  requests,
  loaded,
  properties,
  propertiesError,
  initialView,
  onCreate,
}: {
  requests: RepairRequest[];
  loaded: boolean;
  properties: Property[];
  propertiesError: boolean;
  initialView: "board" | "list";
  onCreate: () => void;
}) {
  const [quick, setQuick] = useState("all");
  const followUps = useQuery({
    queryKey: ["follow-ups"],
    queryFn: () => listFollowUps(),
    refetchInterval: 60000,
  });
  const waiting = useQuery({
    queryKey: ["waiting-cases"],
    queryFn: () => listWaitingCases(),
    refetchInterval: 60000,
  });
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  const due = new Set(
    (followUps.data ?? [])
      .filter((a) => a.dueAt && a.dueAt < tomorrow.getTime())
      .map((a) => a.requestId),
  );
  const [view, setView] = useState(initialView);
  useEffect(() => setView(initialView), [initialView]);
  const [property, setProperty] = useState("all");
  const [priority, setPriority] = useState("all");
  const [query, setQuery] = useState("");
  const addresses = useMemo(() => new Map(properties.map((p) => [p.id, p.address])), [properties]);
  const rows = useMemo(
    () =>
      requests.map((r) => ({
        ...r,
        address: r.propertyId ? (addresses.get(r.propertyId) ?? r.address) : r.address,
      })),
    [requests, addresses],
  );
  const filtered = rows.filter(
    (r) =>
      (quick === "all" ||
        (r.column !== "Completed" &&
          (quick === "due"
            ? due.has(r.id)
            : (waiting.data ?? []).some(
                (w) => w.requestId === r.id && w.role.toLowerCase() === quick,
              )))) &&
      (property === "all" ||
        (property === "unlinked" ? !r.propertyId : r.propertyId === Number(property))) &&
      (priority === "all" || r.priority === priority) &&
      `${r.title} ${r.id} ${r.address}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const hasFilters = quick !== "all" || property !== "all" || priority !== "all" || query !== "";
  const clear = () => {
    setQuick("all");
    setProperty("all");
    setPriority("all");
    setQuery("");
  };
  const unlinked = requests.filter((r) => !r.propertyId).length;
  return (
    <section id="repair-workspace" className="dash-workspace">
      <div className="dash-workspace-heading">
        <div>
          <h2>Repair workspace</h2>
          <p>Track each event from first report to resolution.</p>
        </div>
        <span className="dash-event-count">
          {loaded ? `${requests.length} ${requests.length === 1 ? "event" : "events"}` : "Loading…"}
        </span>
      </div>
      <div className="flex gap-2 px-5 pb-4" role="group" aria-label="Quick event filters">
        {[
          ["all", "All events"],
          ["due", "Due today / overdue"],
          ["landlord", "Waiting on landlord"],
          ["repair team", "Waiting on repair team"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={quick === key}
            onClick={() => setQuick(key!)}
            className={`rounded-full border px-3 py-1.5 text-sm ${quick === key ? "bg-primary text-primary-foreground" : "bg-card"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {(quick === "landlord" || quick === "repair team") && waiting.isError && (
        <p role="alert" className="p-3 text-destructive">
          Could not load waiting actions.{" "}
          <button onClick={() => void waiting.refetch()}>Retry</button>
        </p>
      )}
      {quick === "due" && followUps.isError && (
        <p role="alert" className="p-3 text-destructive">
          Could not load follow-ups. <button onClick={() => void followUps.refetch()}>Retry</button>
        </p>
      )}
      <div className="dash-toolbar">
        <div role="group" aria-label="Workspace view" className="dash-view-tabs">
          {(
            [
              ["board", "Board", LayoutGrid],
              ["list", "All events", List],
            ] as const
          ).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setView(key)} aria-pressed={view === key}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <div className="dash-filters">
          <label className="dash-search">
            <Search size={15} />
            <input
              aria-label="Search events"
              placeholder="Search events…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="dash-select">
            <Building2 size={15} />
            <select
              aria-label="Filter by property"
              value={property}
              onChange={(e) => setProperty(e.target.value)}
            >
              <option value="all">All properties</option>
              <option value="unlinked">No property linked</option>
              {properties.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.address}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="dash-select">
            <SlidersHorizontal size={15} />
            <select
              aria-label="Filter by priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="all">All priorities</option>
              {(["Urgent", "High", "Medium", "Low"] as Priority[]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </div>
      {propertiesError ? (
        <p className="dash-notice" role="alert">
          Property filters could not be loaded. Refresh to try again. Your events are still
          available.
        </p>
      ) : null}
      {unlinked > 0 ? (
        <div className="dash-link-notice">
          <Building2 size={15} />
          <span>
            {unlinked} {unlinked === 1 ? "event needs" : "events need"} a property. Open an event to
            link its PM, landlord and tenant.
          </span>
          <button onClick={() => setProperty("unlinked")}>Review</button>
        </div>
      ) : null}
      {hasFilters ? (
        <div className="dash-filter-summary">
          <span>
            {filtered.length} matching {filtered.length === 1 ? "event" : "events"}
          </span>
          <button onClick={clear}>
            <X size={13} />
            Clear filters
          </button>
        </div>
      ) : null}
      {!loaded ? (
        <div className="dash-empty" role="status">
          Loading your repair workspace…
        </div>
      ) : requests.length === 0 ? (
        <div className="dash-workspace-empty">
          <Building2 size={28} />
          <h3>Your next repair starts here.</h3>
          <p>
            Create a request and choose its property, or bring a tenant email across from your
            inbox.
          </p>
          <button onClick={onCreate} className="dash-button dash-button-primary">
            Create your first request
          </button>
          <Link to="/inbox" className="dash-text-link">
            Open inbox
          </Link>
        </div>
      ) : view === "board" ? (
        <div
          className="dash-board-scroll"
          tabIndex={0}
          role="region"
          aria-label="Repair status board"
        >
          <div className="dash-board">
            {columns.map((c) => (
              <section
                key={c.name}
                className={`dash-column column-${c.name.toLowerCase().replaceAll(" ", "-")}`}
                aria-label={`${c.name} events`}
              >
                <header>
                  <h3>{c.name}</h3>
                  <span>{filtered.filter((r) => r.column === c.name).length}</span>
                </header>
                <div className="dash-column-cards">
                  {filtered
                    .filter((r) => r.column === c.name)
                    .map((r) => (
                      <RequestCard key={r.id} r={r} />
                    ))}
                  {!filtered.some((r) => r.column === c.name) ? (
                    <p className="dash-column-empty">{hasFilters ? "No matches" : "No events"}</p>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="dash-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="All repair events"
        >
          <table className="dash-table">
            <thead>
              <tr>
                <th>Property / event</th>
                <th>Priority</th>
                <th>Stage</th>
                <th>Waiting on</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to="/requests/$id" params={{ id: r.id }}>
                      <strong>{r.propertyId ? r.address : "No property linked"}</strong>
                      <span>{r.title}</span>
                      <small>{r.id}</small>
                    </Link>
                  </td>
                  <td>
                    <span className={`dash-priority-label ${priorityTone[r.priority]}`}>
                      {r.priority}
                    </span>
                  </td>
                  <td>{r.column}</td>
                  <td>{r.waitingOn}</td>
                  <td>{r.lastUpdate}</td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="dash-empty">
                    No events match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
