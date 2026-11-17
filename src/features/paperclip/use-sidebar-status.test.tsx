import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePaperclipStore } from "./store";
import { useSidebarStatus } from "./use-sidebar-status";
vi.mock("@/lib/transport", () => ({ isWeb: false }));
vi.mock("./api", () => ({ paperclipApi: {} }));
function Monitor() { useSidebarStatus(); return null; }
let root: Root; let node: HTMLDivElement;
let initialize: ReturnType<typeof vi.fn>; let refreshStatus: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  initialize = vi.fn().mockResolvedValue(undefined);
  refreshStatus = vi.fn().mockResolvedValue(undefined);
  usePaperclipStore.setState({ initialize, refreshStatus, statusUpdatedAt: null });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); });
it("polls outside the team, pauses while hidden and cleans up on unmount", async () => {
  await act(async () => root.render(<Monitor />));
  expect(refreshStatus).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(refreshStatus).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(refreshStatus).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(refreshStatus).toHaveBeenCalledTimes(3);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(refreshStatus).toHaveBeenCalledTimes(3);
});
it("does not start polling after a late initialization resolves on an unmounted entry", async () => {
  let resolve!: () => void;
  initialize.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
  await act(async () => root.render(<Monitor />));
  await act(async () => root.render(null));
  await act(async () => resolve());
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(refreshStatus).not.toHaveBeenCalled();
});
it("reuses a recent dashboard snapshot rather than duplicating the team refresh", async () => {
  usePaperclipStore.setState({ statusUpdatedAt: Date.now() });
  await act(async () => root.render(<Monitor />));
  expect(refreshStatus).not.toHaveBeenCalled();
});
