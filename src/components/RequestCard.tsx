import { useAsyncAction } from "@/hooks/use-ui-state";
import { ErrorState } from "./workspace-ui";
import { Link } from "@tanstack/react-router";
import { Clock, ArrowRight, MoreHorizontal } from "lucide-react";
import { columns, priorityTone, type RepairRequest } from "@/lib/data";
import { columnStatus, useWorkspace } from "@/lib/workspace";

export function RequestCard({ r }: { r: RepairRequest }) {
  const { updateRequest, notify } = useWorkspace();
  const action = useAsyncAction();
  return (
    <article className="repair-record">
      <Link
        to="/requests/$id"
        params={{ id: r.id }}
        className="record-open"
        aria-label={`Open ${r.id} ${r.title}`}
      />
      <div className="record-issue">
        <span className="record-id">{r.id}</span>
        <h3>{r.title}</h3>
        <p>{r.address}</p>
      </div>
      <div className="record-next">
        <span className="record-actor">Next to act · {r.waitingOn}</span>
        <p>
          <ArrowRight className="h-3 w-3 shrink-0" />
          {r.nextAction}
        </p>
        <span className="record-status">{r.status}</span>
      </div>
      <div className="record-meta">
        <span className={`record-priority ${priorityTone[r.priority]}`}>{r.priority}</span>
        <span>{r.lastUpdate}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {r.waiting}
        </span>
      </div>
      <label
        className="move-request relative z-10 cursor-pointer text-muted-foreground"
        title="Move request"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
        <select
          value={r.column}
          disabled={action.pending}
          onChange={(e) => {
            const column = e.target.value as RepairRequest["column"];
            void action.run(async () => {
              await updateRequest(r.id, {
                column,
                status: columnStatus[column],
                lastUpdate: "Just now",
              });
              notify(`${r.id} moved to ${column}`);
            }, "Could not move this repair. Your original status is unchanged. Please try again.");
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`Move ${r.id} to another status`}
        >
          {columns.map((column) => (
            <option key={column.name}>{column.name}</option>
          ))}
        </select>
      </label>
      {action.error && (
        <div className="record-error">
          <ErrorState message={action.error} />
        </div>
      )}
    </article>
  );
}
