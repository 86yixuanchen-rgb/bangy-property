import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { listAppointments, listProperties } from "@/lib/workspace.functions";
import { FollowUps } from "@/components/case-workflow/CaseWorkflow";
import { CreateRequest } from "@/components/CreateRequest";
import { RepairWorkspace } from "./RepairWorkspace";
import "./dashboard.css";

export function Dashboard({
  initialView = "board",
  initialPropertyId,
  onAskAI,
}: {
  initialView?: "board" | "list";
  initialPropertyId?: number | undefined;
  onAskAI: () => void;
}) {
  const { requests, loaded, addRequest, notify } = useWorkspace();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(Boolean(initialPropertyId));
  useEffect(() => {
    if (initialPropertyId) setNewOpen(true);
  }, [initialPropertyId]);
  const propertiesQuery = useQuery({ queryKey: ["properties"], queryFn: () => listProperties() });
  const appointmentsQuery = useQuery({
    queryKey: ["appointments"],
    queryFn: () => listAppointments(),
  });
  const properties = propertiesQuery.data ?? [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const visits = (appointmentsQuery.data ?? [])
    .filter((a) => !a.cancelledAt && a.startsAt >= start && a.startsAt < end)
    .sort((a, b) => a.startsAt - b.startsAt);
  const active = requests.filter((r) => r.column !== "Completed");
  const weight = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const attention = active
    .filter((r) => r.column === "Action Needed" || r.priority === "Urgent" || r.priority === "High")
    .sort(
      (a, b) =>
        Number(b.column === "Action Needed") - Number(a.column === "Action Needed") ||
        weight[a.priority] - weight[b.priority],
    );
  const propertyAddress = (id: number | null | undefined, fallback: string) =>
    id ? (properties.find((p) => p.id === id)?.address ?? fallback) : "No property linked";
  const metrics = [
    { label: "Active requests", value: loaded ? active.length : "—", icon: Activity, tone: "blue" },
    {
      label: "Needs attention",
      value: loaded ? attention.length : "—",
      icon: AlertCircle,
      tone: "red",
    },
    {
      label: "Waiting on others",
      value: loaded ? requests.filter((r) => r.column === "Waiting").length : "—",
      icon: Users,
      tone: "indigo",
    },
    {
      label: "Visits today",
      value: appointmentsQuery.isSuccess ? visits.length : "—",
      icon: CalendarDays,
      tone: "blue",
    },
  ];
  return (
    <div className="dashboard">
      <header className="dash-heading">
        <div>
          <h1>Your workspace, at a glance.</h1>
          <p>Every property. Every repair. A clear next step.</p>
        </div>
        <div className="dash-heading-actions">
          <time
            dateTime={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`}
          >
            {now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
          </time>
          <button className="dash-button dash-button-primary" onClick={() => setNewOpen(true)}>
            <Plus size={17} />
            Create request
          </button>
        </div>
      </header>
      <FollowUps />
      <section className="dash-metrics" aria-label="Workspace overview">
        {metrics.map((m) => (
          <div className="dash-metric" key={m.label}>
            <span className={`dash-metric-icon ${m.tone}`}>
              <m.icon size={21} strokeWidth={1.8} />
            </span>
            <div>
              <span>{m.label}</span>
              <strong>{m.value}</strong>
            </div>
          </div>
        ))}
      </section>
      <div className="dash-overview">
        <section className="dash-panel dash-attention">
          <div className="dash-panel-heading">
            <h2>Needs your attention</h2>
            <button onClick={onAskAI} className="dash-button dash-button-ai">
              <Sparkles size={16} />
              Ask Banjg AI
            </button>
          </div>
          {!loaded ? (
            <p className="dash-empty" role="status">
              Loading your requests…
            </p>
          ) : attention.length === 0 ? (
            <div className="dash-empty">
              <CheckCheck size={24} />
              <strong>You're all caught up.</strong>
              <span>No requests need your attention right now.</span>
            </div>
          ) : (
            <div className="dash-task-list">
              {attention.slice(0, 3).map((r) => (
                <Link className="dash-task" key={r.id} to="/requests/$id" params={{ id: r.id }}>
                  <span className={`dash-task-priority priority-${r.priority.toLowerCase()}`}>
                    <i />
                    {r.priority}
                  </span>
                  <span className="dash-task-property">
                    <strong>{propertyAddress(r.propertyId, r.address)}</strong>
                    <span>{r.title}</span>
                  </span>
                  <span className="dash-task-next">
                    <span>Next step</span>
                    <strong>{r.nextAction}</strong>
                  </span>
                  <ChevronRight size={17} />
                </Link>
              ))}
            </div>
          )}
          {attention.length > 3 ? (
            <a href="#repair-workspace" className="dash-more">
              View all {attention.length} in the workspace
              <ArrowUpRight size={14} />
            </a>
          ) : null}
        </section>
        <section className="dash-panel dash-visits">
          <div className="dash-panel-heading">
            <h2>Today's visits</h2>
            <Link
              to="/workspace/$section"
              params={{ section: "calendar" }}
              className="dash-text-link"
            >
              Open calendar
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {appointmentsQuery.isError ? (
            <div className="dash-empty">
              <span>Could not load today's visits.</span>
              <button className="dash-text-link" onClick={() => void appointmentsQuery.refetch()}>
                Try again
              </button>
            </div>
          ) : appointmentsQuery.isPending ? (
            <p className="dash-empty" role="status">
              Loading visits…
            </p>
          ) : visits.length === 0 ? (
            <div className="dash-empty">
              <CalendarDays size={24} />
              <strong>A little breathing room.</strong>
              <span>No visits scheduled for today.</span>
            </div>
          ) : (
            <ol className="dash-timeline">
              {visits.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <span className="dash-timeline-dot" />
                  <time dateTime={new Date(a.startsAt).toISOString()}>
                    {new Date(a.startsAt).toLocaleTimeString("en-AU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </time>
                  <div>
                    {a.requestId ? (
                      <Link to="/requests/$id" params={{ id: a.requestId }}>
                        {a.title}
                      </Link>
                    ) : (
                      <strong>{a.title}</strong>
                    )}
                    <span>{propertyAddress(a.propertyId, a.location)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {visits.length > 3 ? (
            <Link to="/workspace/$section" params={{ section: "calendar" }} className="dash-more">
              {visits.length - 3} more visits today
              <ArrowUpRight size={14} />
            </Link>
          ) : null}
        </section>
      </div>
      <RepairWorkspace
        requests={requests}
        loaded={loaded}
        properties={properties}
        propertiesError={propertiesQuery.isError}
        initialView={initialView}
        onCreate={() => setNewOpen(true)}
      />
      {newOpen ? (
        <CreateRequest
          initialPropertyId={initialPropertyId}
          onClose={() => setNewOpen(false)}
          onSubmit={async (input) => {
            const item = await addRequest(input);
            setNewOpen(false);
            notify(`${item.id} created`);
            void navigate({ to: "/requests/$id", params: { id: item.id } });
          }}
        />
      ) : null}
    </div>
  );
}
