import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getReviewQueue } from "@/lib/assistant-followthrough.functions";
import { openAssistant } from "@/lib/assistant-open";
export function ReviewCenter() {
  const [filter, setFilter] = useState("All"),
    [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => getReviewQueue(),
    refetchInterval: 10000,
  });
  const kinds = ["All", ...new Set(q.data?.map((r) => r.kind))];
  const rows =
    q.data?.filter(
      (r) =>
        (filter === "All" || r.kind === filter) &&
        `${r.title} ${r.detail}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One place for drafts, replies, missing information and interrupted work. Each email still
        needs its own send confirmation.
      </p>
      <input
        aria-label="Search review queue"
        placeholder="Search case, task or conversation…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded border p-3 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            className={`rounded-full border px-3 py-1.5 text-xs ${filter === k ? "bg-primary text-white" : "bg-card"}`}
            key={k}
            onClick={() => setFilter(k)}
          >
            {k} · {k === "All" ? (q.data?.length ?? 0) : q.data?.filter((r) => r.kind === k).length}
          </button>
        ))}
      </div>
      {q.isPending && <p>Loading pending work…</p>}
      {q.isError && <button onClick={() => void q.refetch()}>Could not load reviews. Retry</button>}
      {!q.isPending && !q.isError && !rows.length && (
        <p className="rounded border p-8 text-center">No items need review in this view.</p>
      )}
      <div className="grid gap-3">
        {rows.map((r) => (
          <article
            key={r.id}
            className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4"
          >
            <div>
              <span className="text-xs text-primary">{r.kind}</span>
              <h2 className="font-medium">{r.title}</h2>
              <p className="text-xs text-muted-foreground">{r.detail}</p>
            </div>
            {r.sessionId ? (
              <button
                className="shrink-0 rounded border px-3 py-2 text-sm"
                onClick={() => openAssistant({ sessionId: r.sessionId, stepId: r.id })}
              >
                Review in chat
              </button>
            ) : (
              <a className="shrink-0 rounded border px-3 py-2 text-sm" href={r.href}>
                Open review →
              </a>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
