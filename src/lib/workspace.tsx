import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Column, type Priority, type RepairRequest } from "./data";
import { useAuth } from "./auth";
import { createRequest, listRequests, patchRequest } from "./requests.functions";

export type Toast = { id: number; message: string };

type WorkspaceValue = {
  requests: RepairRequest[];
  loaded: boolean;
  addRequest: (input: {
    title: string;
    address: string;
    priority: Priority;
  }) => Promise<RepairRequest>;
  updateRequest: (id: string, patch: Partial<RepairRequest>) => void;
  toasts: Toast[];
  notify: (message: string) => void;
  dismissToast: (id: number) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuth();
  const { data } = useQuery({
    queryKey: ["requests"],
    queryFn: () => listRequests(),
    enabled: isSignedIn,
    staleTime: Infinity,
  });
  const requests = useMemo(() => data ?? [], [data]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  const notify = (message: string) => {
    const id = ++toastCounter.current;
    setToasts((items) => [...items, { id, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3500);
  };

  const value = useMemo<WorkspaceValue>(() => {
    const rollback = (message: string) => {
      notify(message);
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
    };
    return {
      requests,
      loaded: data !== undefined,
      addRequest: async (input) => {
        const item = await createRequest({ data: input });
        queryClient.setQueryData<RepairRequest[]>(["requests"], (items) => [
          item,
          ...(items ?? []),
        ]);
        return item;
      },
      updateRequest: (id, patch) => {
        queryClient.setQueryData<RepairRequest[]>(["requests"], (items) =>
          (items ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );
        const { id: _ignored, ...fields } = patch;
        patchRequest({ data: { id, patch: fields } }).catch(() =>
          rollback("Could not save the change"),
        );
      },
      toasts,
      notify,
      dismissToast: (id) => setToasts((items) => items.filter((item) => item.id !== id)),
    };
  }, [requests, data, toasts, queryClient]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export const columnStatus: Record<Column, string> = {
  New: "Awaiting triage",
  Waiting: "Waiting for response",
  "Action Needed": "Action required",
  Scheduled: "Booked",
  Completed: "Completed",
};
