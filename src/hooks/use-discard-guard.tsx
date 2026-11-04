import { useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/** Navigation, reload, Escape, and explicit close share the same discard guard. */
export function useDiscardGuard(dirty: boolean, busy = false, blockNavigation = true) {
  const opener = useRef<HTMLElement | null>(null);
  const captureFocus = () => {
    opener.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const current = useRef({ dirty, busy });
  current.current = { dirty, busy };
  const [deferred, setDeferred] = useState<(() => void) | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: () => {
      if (current.current.dirty || current.current.busy) {
        captureFocus();
        return true;
      }
      return false;
    },
    enableBeforeUnload: () => current.current.dirty || current.current.busy,
    withResolver: true,
    disabled: !blockNavigation,
  });
  const confirm = (action: () => void) => {
    if (current.current.busy) return;
    if (current.current.dirty) {
      captureFocus();
      setDeferred(() => action);
    } else action();
  };
  const complete = (action: () => void) => {
    // The server has confirmed the save; navigation must not be blocked by
    // the pending flag from the render that initiated it.
    current.current = { dirty: false, busy: false };
    action();
  };
  const confirmation = (
    <AlertDialog
      open={deferred !== null || blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) {
          setDeferred(null);
          blocker.reset?.();
        }
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
        <AlertDialogDescription>
          Your edits have not been saved. Keep editing to avoid losing them.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={() => {
              current.current.dirty = false;
              const action = deferred;
              setDeferred(null);
              if (blocker.status === "blocked") blocker.proceed();
              else action?.();
            }}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, complete, confirmation };
}
