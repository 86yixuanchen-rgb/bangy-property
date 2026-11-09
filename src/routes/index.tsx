import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/dashboard/Dashboard";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "list"; property?: number } => ({
    ...(search["view"] === "list" ? { view: "list" as const } : {}),
    ...(Number.isSafeInteger(Number(search["property"])) && Number(search["property"]) > 0
      ? { property: Number(search["property"]) }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Home — Banjg Property" },
      {
        name: "description",
        content: "See every repair request, who it's waiting on and what happens next.",
      },
    ],
  }),
  component: DashboardRoute,
});
function DashboardRoute() {
  const search = Route.useSearch();
  const [aiSeed, setAiSeed] = useState(0);
  return (
    <AppShell openAssistantSignal={aiSeed}>
      <Dashboard
        initialView={search.view === "list" ? "list" : "board"}
        initialPropertyId={search.property}
        onAskAI={() => setAiSeed((v) => v + 1)}
      />
    </AppShell>
  );
}
