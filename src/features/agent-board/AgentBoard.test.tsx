import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/chat/components/ChatConversation", () => ({
  ChatConversation: ({ active }: { active: { sessionId: string | null } }) => <div data-chat>{active.sessionId || "draft"}</div>,
}));
vi.mock("@/features/chat/store", async () => {
  const { create } = await import("zustand");
  const store = create<any>((set) => ({
    openTabs: [], bySession: {}, sessions: [], workspaces: [], streamingByKey: {}, retryingByKey: {}, unseen: {}, active: null,
    focusTab: (engine: string, sessionId: string, workspacePath: string) => set({ active: { engine, sessionId, workspacePath } }),
  }));
  return { useChatStore: store };
});
import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { useAgentBoardStore } from "./store";
import { sessionKey } from "@/features/chat/store/persistence";
import { AgentBoard } from "./AgentBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const one = { engine: "codex", sessionId: "one", workspacePath: "/one" };
const two = { engine: "claude", sessionId: "two", workspacePath: "/two" };
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  useAgentBoardStore.setState({ open: true, active: true, selectedKey: null, filter: "all", search: "", project: "" });
  useChatStore.setState({ openTabs: [one, two], active: one });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AgentBoard engines={[]} workspaces={[]} startNewChat={() => {}} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
it("keeps keyboard selection and preview closing on the board", async () => {
  const card = container.querySelector<HTMLElement>('[role="button"]')!;
  await act(async () => card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(container.querySelector('[data-chat]')?.textContent).toBe("one");
  expect(useAgentBoardStore.getState().active).toBe(true);
  const close = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.getAttribute("aria-label") === i18n.t("agentBoard.close"));
  expect(close).toBeTruthy();
  await act(async () => close!.click());
  expect(container.querySelector('[data-chat]')).toBeNull();
  expect(useAgentBoardStore.getState().active).toBe(true);
});
it("filters cards and counters by project", async () => {
  const project = container.querySelector("select")!;
  await act(async () => {
    project.value = "/two";
    project.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
  expect(container.querySelector('[role="button"]')?.textContent).toContain("two");
  expect(useAgentBoardStore.getState().project).toBe("/two");
});
it("follows the first-send session id without leaving the board", async () => {
  const draft = { ...one, sessionId: null };
  await act(async () => {
    useChatStore.setState({ openTabs: [draft], active: draft });
    useAgentBoardStore.getState().select(sessionKey("codex", null, "/one"));
  });
  expect(container.querySelector('[data-chat]')?.textContent).toBe("draft");
  await act(async () => useChatStore.setState({ openTabs: [one], active: one }));
  expect(container.querySelector('[data-chat]')?.textContent).toBe("one");
  expect(useAgentBoardStore.getState().active).toBe(true);
});
