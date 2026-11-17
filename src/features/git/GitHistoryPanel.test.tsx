import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadLog: vi.fn() }));
vi.mock("./store", () => ({ useGitStore: Object.assign(
  (select: (s: unknown) => unknown) => select({ logByWorkspace: {} }),
  { getState: () => ({ loadLog: mocks.loadLog }) },
) }));
import "@/lib/i18n";
import { GitHistoryPanel } from "./GitHistoryPanel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
it("shows loading and errors inline, and retries without a modal", async () => {
  let reject!: (err: Error) => void;
  mocks.loadLog.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<GitHistoryPanel workspacePath="/repo" onClose={() => {}} />));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.textContent).not.toContain("暂无提交");
  await act(async () => reject(new Error("history read failed")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("history read failed");
  mocks.loadLog.mockResolvedValueOnce(undefined);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')!.click());
  expect(mocks.loadLog).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
