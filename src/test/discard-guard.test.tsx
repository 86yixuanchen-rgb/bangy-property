import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiscardGuard } from "@/hooks/use-discard-guard";
const captured = vi.hoisted(() => ({
  options: null as null | { shouldBlockFn: () => boolean; enableBeforeUnload: () => boolean },
}));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: typeof captured.options) => {
    captured.options = options;
    return { status: "idle" };
  },
}));
describe("Unsaved-change navigation guard", () => {
  it("allows confirmed-save navigation even before the pending render is cleared", () => {
    const { result } = renderHook(() => useDiscardGuard(true, true));
    expect(captured.options?.shouldBlockFn()).toBe(true);
    const navigate = vi.fn(() => {
      expect(captured.options?.shouldBlockFn()).toBe(false);
      expect(captured.options?.enableBeforeUnload()).toBe(false);
    });
    act(() => result.current.complete(navigate));
    expect(navigate).toHaveBeenCalledOnce();
  });
  it("does not discard edits or invoke close while a save is in progress", () => {
    const { result } = renderHook(() => useDiscardGuard(true, true));
    const close = vi.fn();
    act(() => result.current.confirm(close));
    expect(close).not.toHaveBeenCalled();
    expect(captured.options?.shouldBlockFn()).toBe(true);
  });
});
