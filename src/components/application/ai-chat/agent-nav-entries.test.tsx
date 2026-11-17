import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { useAgentBoardStore } from "@/features/agent-board/store";
import { usePaperclipStore } from "@/features/paperclip/store";
import { sessionKey } from "@/features/chat/store/persistence";
import type { SessionState } from "@/features/chat/store/stream";
import { AgentBoardNavEntry, PaperclipNavEntry } from "./agent-nav-entries";

vi.mock("@/features/paperclip/use-sidebar-status", () => ({ useSidebarStatus: () => {} }));
let node: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await i18n.changeLanguage("en");
  useChatStore.setState({ openTabs: [], bySession: {}, streamingByKey: {}, retryingByKey: {}, unseen: {} });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
function button(label: string) {
  const found = [...node.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
it("updates session markers outside the board and opens the matching filter", async () => {
  const onOpen = vi.fn();
  await act(async () => root.render(<AgentBoardNavEntry onOpen={onOpen} />));
  const tab = { engine: "codex" as const, sessionId: "live", workspacePath: "/repo" };
  const key = sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
  await act(async () => useChatStore.setState({ openTabs: [tab], streamingByKey: { [key]: true } }));
  expect(button("Working: 1")).toBeTruthy();
  useAgentBoardStore.setState({ filter: "error", search: "old", project: "/other" });
  await act(async () => button("Working: 1").click());
  expect(onOpen).toHaveBeenCalledOnce();
  expect(useAgentBoardStore.getState()).toMatchObject({ filter: "running", search: "", project: "" });
  await act(async () => useChatStore.setState({
    streamingByKey: {}, bySession: { [key]: { messages: [], error: "failed" } as unknown as SessionState },
  }));
  expect(node.textContent).not.toContain("Working");
  expect(button("Errors: 1")).toBeTruthy();
});
it("shows Paperclip attention and replaces stale counters with offline status", async () => {
  const onOpen = vi.fn();
  usePaperclipStore.setState({ connected: true, companyId: "one", statusUpdatedAt: Date.now(), statusError: null, error: null,
    dashboard: { agents: { active: 4, running: 2, paused: 0, error: 1 }, tasks: { open: 5, inProgress: 2, blocked: 3, done: 1 },
      pendingApprovals: 1, costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 } } });
  await act(async () => root.render(<PaperclipNavEntry onOpen={onOpen} />));
  expect(button("Working: 2")).toBeTruthy();
  const attention = button("approvals: 1, blocked tasks: 3");
  expect(attention.textContent).toBe("4");
  await act(async () => attention.click());
  expect(onOpen).toHaveBeenCalledOnce();
  expect(usePaperclipStore.getState().view).toBe("approvals");
  await act(async () => usePaperclipStore.setState({ statusError: "offline" }));
  expect(node.querySelectorAll("button")).toHaveLength(2);
  await act(async () => button("Status unavailable").click());
  expect(usePaperclipStore.getState().view).toBe("settings");
});
