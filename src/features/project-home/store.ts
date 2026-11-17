import { create } from "zustand";

export const PROJECT_TAB_PREFIX = "project:";
export type ProjectSection = "tasks" | "sessions" | "files" | "activity";
export interface ProjectBinding { port: number; companyId: string; projectId: string }
const STORAGE = "ccgui.projectBindings.v1";
function readBindings(): Record<string, ProjectBinding | null> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, binding]) => binding === null || (
      typeof binding === "object" && Number.isInteger(binding.port) && typeof binding.companyId === "string" && typeof binding.projectId === "string"
    )));
  } catch { return {}; }
}
export const normalizeProjectPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
export const useProjectHomeStore = create<{
  paths: string[]; activePath: string | null; bindings: Record<string, ProjectBinding | null>;
  open: (path: string) => void; activate: (path: string) => void; deactivate: () => void;
  close: (path: string) => void; bind: (path: string, binding: ProjectBinding | null) => void;
}>()((set, get) => ({
  paths: [], activePath: null, bindings: readBindings(),
  open: (path) => set((s) => ({ paths: s.paths.includes(path) ? s.paths : [...s.paths, path], activePath: path })),
  activate: (path) => { if (get().paths.includes(path)) set({ activePath: path }); },
  deactivate: () => { if (get().activePath !== null) set({ activePath: null }); },
  close: (path) => set((s) => ({ paths: s.paths.filter((p) => p !== path), activePath: s.activePath === path ? null : s.activePath })),
  bind: (path, binding) => {
    const bindings = { ...get().bindings, [normalizeProjectPath(path)]: binding };
    set({ bindings });
    try { localStorage.setItem(STORAGE, JSON.stringify(bindings)); } catch { /* In-memory association remains usable. */ }
  },
}));
