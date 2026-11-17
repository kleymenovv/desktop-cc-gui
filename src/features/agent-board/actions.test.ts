import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "@/features/chat/store/persistence";
import { sessionKey } from "@/features/chat/store/persistence";
import { useAgentBoardStore } from "./store";

const mocks = vi.hoisted(() => ({ focusTab: vi.fn(), dismiss: vi.fn(), waiting: [] as ActiveSession[] }));
vi.mock("@/features/chat/center-surfaces", () => ({ dismissCenterSurfaces: mocks.dismiss }));
vi.mock("@/features/chat/store", () => ({ useChatStore: { getState: () => ({
  focusTab: mocks.focusTab, openTabs: mocks.waiting, bySession: {}, active: null,
}) } }));
vi.mock("./derive", () => ({ waitingTabs: () => mocks.waiting }));
import { expandAgentSession, focusAgentSession, focusNextWaitingAgent } from "./actions";

const first = { engine: "codex", sessionId: "one", workspacePath: "/one" };
const second = { engine: "claude", sessionId: "two", workspacePath: "/two" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.waiting = [first, second];
  useAgentBoardStore.getState().close();
});

describe("board session navigation", () => {
  it("opens previews without dismissing the board", () => {
    useAgentBoardStore.getState().openBoard();
    focusAgentSession(first);
    expect(useAgentBoardStore.getState().selectedKey).toBe(sessionKey("codex", "one", "/one"));
    expect(useAgentBoardStore.getState().active).toBe(true);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.focusTab).not.toHaveBeenCalled();
  });

  it("cycles waiting previews and wraps while staying on the board", () => {
    useAgentBoardStore.getState().openBoard();
    focusAgentSession(first);
    expect(focusNextWaitingAgent()).toBe(true);
    expect(useAgentBoardStore.getState().selectedKey).toBe(sessionKey("claude", "two", "/two"));
    focusNextWaitingAgent();
    expect(useAgentBoardStore.getState().selectedKey).toBe(sessionKey("codex", "one", "/one"));
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("keeps the toolbar's next-waiting action inside the selected project", () => {
    useAgentBoardStore.getState().openBoard();
    focusAgentSession(first);
    focusNextWaitingAgent("/two");
    expect(useAgentBoardStore.getState().selectedKey).toBe(sessionKey("claude", "two", "/two"));
    expect(focusNextWaitingAgent("/missing")).toBe(false);
  });

  it("expands only when explicitly requested, and keeps normal chat navigation", () => {
    useAgentBoardStore.getState().openBoard();
    expandAgentSession(first);
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(mocks.focusTab).toHaveBeenCalledWith("codex", "one", "/one");
    useAgentBoardStore.getState().close();
    focusAgentSession(second);
    expect(mocks.focusTab).toHaveBeenLastCalledWith("claude", "two", "/two");
  });
});
