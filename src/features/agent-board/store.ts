import { create } from "zustand";

/**
 * Agent board center tab (native single instance, same open/active semantics
 * as the plugin hub, mission workbench and release notes tabs): one screen
 * listing every open session tab with what its agent is doing and why.
 */

export const AGENT_BOARD_TAB_KEY = "agent-board:main";

export type AgentBoardFilter = "all" | "waiting" | "running" | "done" | "error";

interface AgentBoardState {
  /** Tab exists in the strip. */
  open: boolean;
  /** Board is the center surface in view. */
  active: boolean;
  filter: AgentBoardFilter;
  search: string;
  /** Session key whose detail drawer is open; null = drawer closed. */
  selectedKey: string | null;
  openBoard: () => void;
  activate: () => void;
  deactivate: () => void;
  close: () => void;
  setFilter: (filter: AgentBoardFilter) => void;
  setSearch: (search: string) => void;
  select: (key: string | null) => void;
}

export const useAgentBoardStore = create<AgentBoardState>()((set, get) => ({
  open: false,
  active: false,
  filter: "all",
  search: "",
  selectedKey: null,

  openBoard: () => set({ open: true, active: true }),
  activate: () => set({ active: true }),
  deactivate: () => {
    if (!get().active) return;
    set({ active: false });
  },
  close: () => set({ open: false, active: false, selectedKey: null }),
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  select: (selectedKey) => set({ selectedKey }),
}));
