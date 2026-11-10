import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { useChatStore } from "@/features/chat/store";
import { sessionKey, type ActiveSession } from "@/features/chat/store/persistence";
import { waitingTabs } from "./derive";
import { useAgentBoardStore } from "./store";

/** Open (or bring forward) the board tab; other center surfaces yield first
 *  so the highlighted tab and the visible surface agree. */
export function openAgentBoard(): void {
  window.location.hash = "#/";
  dismissCenterSurfaces();
  useAgentBoardStore.getState().openBoard();
}

/** Leave the board for one agent's session tab. */
export function focusAgentSession(tab: ActiveSession): void {
  window.location.hash = "#/";
  dismissCenterSurfaces();
  useChatStore.getState().focusTab(tab.engine, tab.sessionId, tab.workspacePath);
}

/** Cycle to the next session blocked on the user, starting after the tab in
 *  view. Returns false when nobody is waiting. */
export function focusNextWaitingAgent(): boolean {
  const { openTabs, bySession, active } = useChatStore.getState();
  const waiting = waitingTabs(openTabs, bySession);
  if (waiting.length === 0) return false;
  const activeKey = active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : null;
  const keyOf = (tab: ActiveSession) => sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
  // Order by tab position so repeated presses walk the strip left to right.
  const activeIndex = openTabs.findIndex((tab) => keyOf(tab) === activeKey);
  const onBoard = useAgentBoardStore.getState().active;
  const next =
    (!onBoard && activeIndex >= 0
      ? waiting.find((tab) => openTabs.findIndex((t) => keyOf(t) === keyOf(tab)) > activeIndex)
      : undefined) ?? waiting[0];
  focusAgentSession(next);
  return true;
}
