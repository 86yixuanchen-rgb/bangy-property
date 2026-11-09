import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { listNotifications, markNotificationsRead } from "@/lib/workflow-management.functions";
export function NotificationBell() {
  const [open, setOpen] = useState(false),
    [all, setAll] = useState(false),
    [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    refetchInterval: 60000,
  });
  const items = query.data ?? [],
    unread = items.filter((n) => !n.read);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const read = async (keys: string[]) => {
    setError("");
    try {
      for (let i = 0; i < keys.length; i += 100)
        await markNotificationsRead({ data: { keys: keys.slice(i, i + 100) } });
      await client.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      setError("Could not mark notifications as read. Try again.");
    }
  };
  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative rounded p-2 text-muted-foreground hover:bg-muted"
      >
        <Bell size={20} />
        {unread.length > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
            {unread.length}
          </span>
        )}
      </button>
      {open && (
        <section
          aria-label="Notifications panel"
          className="absolute right-0 top-10 z-50 w-96 rounded-lg border bg-card shadow-xl"
        >
          <header className="space-y-2 border-b p-3">
            <div className="flex justify-between">
              <strong>Notifications</strong>
              <button
                className="text-xs text-primary"
                disabled={!unread.length}
                onClick={() => void read(unread.map((n) => n.key))}
              >
                Mark all read
              </button>
            </div>
            <button className="text-xs text-primary" onClick={() => setAll(!all)}>
              {all ? "Show unread" : "Show read & unread"}
            </button>
          </header>
          <div className="max-h-96 overflow-auto">
            {query.isPending && <p className="p-4">Loading…</p>}
            {query.isError && (
              <button onClick={() => void query.refetch()} className="p-4 text-destructive">
                Could not load notifications. Retry
              </button>
            )}
            {(all ? items : unread).map((n) => (
              <div key={n.key} className={`border-b p-3 text-sm ${n.read ? "opacity-60" : ""}`}>
                <Link
                  to="/requests/$id"
                  params={{ id: n.requestId }}
                  onClick={() => {
                    void read([n.key]);
                    setOpen(false);
                  }}
                  className="block hover:text-primary"
                >
                  <strong>{n.title}</strong>
                  <p>
                    {n.requestId} · {n.detail}
                  </p>
                  {n.at > 0 && (
                    <time className="text-xs text-muted-foreground">
                      {new Date(n.at).toLocaleString()}
                    </time>
                  )}
                </Link>
                {!n.read && (
                  <button className="mt-1 text-xs text-primary" onClick={() => void read([n.key])}>
                    Mark read
                  </button>
                )}
              </div>
            ))}
            {!query.isPending && !query.isError && !(all ? items : unread).length && (
              <p className="p-5 text-sm text-muted-foreground">All caught up.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
