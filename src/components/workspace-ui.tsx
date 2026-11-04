import { useDiscardGuard } from "@/hooks/use-discard-guard";
import { useRef, type ReactNode } from "react";
import { AlertCircle, ArrowRight, Inbox, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

import type { Column } from "@/lib/data";

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="page-eyebrow">RepairFlow workspace</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function StatusLabel({ status }: { status: Column }) {
  return (
    <span className={`status-label status-${status.toLowerCase().replaceAll(" ", "-")}`}>
      <span aria-hidden="true" />
      {status === "Action Needed" ? "Needs attention" : status}
    </span>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="action-error" role="alert">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  search = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  search?: boolean;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{search ? <ArrowRight /> : <Inbox />}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function LoadingRows({ label = "Loading repairs" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="loading-rows">
      <span className="sr-only">{label}…</span>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
export function PendingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
      {children}
    </span>
  );
}

export function FormDialog({
  title,
  description,
  dirty,
  busy = false,
  guardNavigation = true,
  onClose,
  children,
}: {
  title: string;
  description: string;
  dirty: boolean;
  busy?: boolean;
  guardNavigation?: boolean;
  onClose: () => void;
  children: (controls: { close: () => void; finish: () => void }) => ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const { confirm, complete, confirmation } = useDiscardGuard(dirty, busy, guardNavigation);
  const close = () => confirm(onClose);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="form-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {children({ close, finish: () => complete(onClose) })}
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}
