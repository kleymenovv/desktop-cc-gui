import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useChatTabs, type UseChatTabsResult } from "@/features/chat/use-chat-tabs";
import { useChatStore } from "@/features/chat/store";
import { useBrowserStore } from "@/features/browser/store";
import { useFilesStore } from "@/features/files/store";
import { useGitStore } from "@/features/git/store";
import { useAgentBoardStore } from "@/features/agent-board/store";
import { useMissionStore } from "@/features/mission/store";
import { PLUGIN_HUB_TAB_KEY, usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { useReleaseNotesTabStore } from "@/features/update/notes-tab";
import { openPaperclipTeam } from "./actions";
import { PAPERCLIP_TAB_KEY, usePaperclipStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let tabs: UseChatTabsResult;
function Probe() { tabs = useChatTabs({ setDialog: () => {} }); return null; }
beforeEach(() => {
  useChatStore.setState({ active: null, openTabs: [], sessions: [], unseen: {}, streamingByKey: {}, retryingByKey: {} });
  useBrowserStore.setState({ tabs: [], activeId: null });
  useFilesStore.setState({ openFiles: [], fileStates: {}, activeFilePath: null });
  usePluginTabsStore.setState({ tabs: [], activeId: null });
  useGitStore.getState().closeDiff(); useMissionStore.getState().close(); useAgentBoardStore.getState().close();
  usePluginHubStore.getState().close(); useReleaseNotesTabStore.getState().close(); usePaperclipStore.getState().close();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); usePaperclipStore.getState().close(); });

it("opens a single native team tab and yields when another tab is selected", () => {
  act(() => { usePluginHubStore.getState().openHub(); openPaperclipTeam(); openPaperclipTeam(); });
  expect(tabs.tabItems.filter((t) => t.key === PAPERCLIP_TAB_KEY)).toHaveLength(1);
  expect(tabs.activeTabKey).toBe(PAPERCLIP_TAB_KEY);
  expect(usePluginHubStore.getState().active).toBe(false);
  act(() => tabs.handleTabSelect(PLUGIN_HUB_TAB_KEY));
  expect(usePaperclipStore.getState().active).toBe(false);
  expect(usePaperclipStore.getState().open).toBe(true);
  act(() => tabs.handleTabSelect(PAPERCLIP_TAB_KEY));
  expect(usePaperclipStore.getState().active).toBe(true);
  expect(usePluginHubStore.getState().active).toBe(false);
});

it("closing team tabs leaves the independent service status and data intact", () => {
  usePaperclipStore.setState({ service: { supported: true, installed: true, running: true } });
  act(() => openPaperclipTeam());
  act(() => tabs.handleTabCloseAll());
  expect(usePaperclipStore.getState().open).toBe(false);
  expect(usePaperclipStore.getState().service?.running).toBe(true);
});

it("direct file activation dismisses the team page as well as tab-strip navigation", () => {
  act(() => openPaperclipTeam());
  act(() => useFilesStore.getState().activateFile("/example.ts"));
  expect(usePaperclipStore.getState().active).toBe(false);
});
