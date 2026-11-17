import { create } from "zustand";
import { paperclipApi, type Agent, type Company, type Dashboard, type Issue, type PaperclipConfig, type Project, type Run, type ServiceStatus } from "./api";

export const PAPERCLIP_TAB_KEY = "paperclip:team";
export type TeamView = "tasks" | "agents" | "projects" | "goals" | "approvals" | "routines" | "budgets" | "activity" | "usage" | "settings";

interface TeamState {
  open: boolean; active: boolean; initialized: boolean; connected: boolean;
  config: PaperclipConfig | null; service: ServiceStatus | null; version: string | null;
  companies: Company[]; companyId: string; agents: Agent[]; projects: Project[];
  issues: Issue[]; runs: Run[]; dashboard: Dashboard | null;
  view: TeamView; search: string; projectId: string; selectedIssueId: string | null;
  loading: boolean; busy: string | null; error: string | null; sectionErrors: string[]; updatedAt: number | null; statusUpdatedAt: number | null; statusError: string | null;
  openTeam: () => void; activate: () => void; deactivate: () => void; close: () => void;
  setView: (view: TeamView) => void; setSearch: (search: string) => void; setProject: (projectId: string) => void;
  selectIssue: (selectedIssueId: string | null) => void;
  initialize: () => Promise<void>; connect: (config: PaperclipConfig) => Promise<void>;
  refreshStatus: () => Promise<void>;
  selectCompany: (id: string) => Promise<void>; refresh: () => Promise<void>;
  mutate: <T>(key: string, action: () => Promise<T>) => Promise<T>;
  controlService: (action: "start" | "stop", config?: PaperclipConfig) => Promise<void>;
}

let generation = 0;
let dashboardRequest = 0;
let initialization: Promise<void> | null = null;
let refreshFlight: { generation: number; promise: Promise<void> } | null = null;
let statusFlight: { generation: number; promise: Promise<void> } | null = null;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const empty = { agents: [], projects: [], issues: [], runs: [], dashboard: null, sectionErrors: [], updatedAt: null, statusUpdatedAt: null, statusError: null };

export const usePaperclipStore = create<TeamState>()((set, get) => ({
  open: false, active: false, initialized: false, connected: false,
  config: null, service: null, version: null, companies: [], companyId: "", ...empty,
  view: "tasks", search: "", projectId: "", selectedIssueId: null,
  loading: false, busy: null, error: null,
  openTeam: () => set({ open: true, active: true }),
  activate: () => set({ active: true }),
  deactivate: () => { if (get().active) set({ active: false }); },
  close: () => set({ open: false, active: false }),
  setView: (view) => set({ view }), setSearch: (search) => set({ search }),
  setProject: (projectId) => set({ projectId }), selectIssue: (selectedIssueId) => set({ selectedIssueId }),
  initialize: () => {
    if (get().initialized) return Promise.resolve();
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const result = await paperclipApi.config();
        set({ config: result.config, service: result.service, initialized: true });
        if (result.configured) await get().connect(result.config);
      } catch (error) { set({ error: message(error), initialized: true }); }
      finally { initialization = null; }
    })();
    return initialization;
  },
  connect: async (config) => {
    if (get().busy) throw new Error("Another Paperclip operation is still running");
    const current = ++generation;
    set({ busy: "connect", loading: false, error: null, connected: false, companies: [], companyId: "", selectedIssueId: null, ...empty });
    try {
      const health = await paperclipApi.connect(config);
      const companies = await paperclipApi.request<Company[]>("companies");
      if (current !== generation) return;
      const companyId = companies.find((c) => c.status === "active")?.id ?? companies[0]?.id ?? "";
      set({ config, version: health.version ?? null, companies, companyId, connected: true });
      await get().refresh();
    } catch (error) {
      if (current === generation) set({ error: message(error), connected: false });
      throw error;
    } finally { if (current === generation) set({ busy: null }); }
  },
  selectCompany: async (companyId) => {
    if (get().busy || !get().companies.some((c) => c.id === companyId)) return;
    ++generation;
    set({ companyId, projectId: "", search: "", selectedIssueId: null, loading: false, error: null, ...empty });
    await get().refresh();
  },
  // Read-only sidebar polling: no limits, credentials, worker start or mutations.
  refreshStatus: () => {
    const state = get();
    if (!state.connected || !state.companyId) return Promise.resolve();
    if (statusFlight?.generation === generation) return statusFlight.promise;
    if (refreshFlight?.generation === generation) return refreshFlight.promise.catch(() => {});
    const current = generation;
    const id = state.companyId;
    const request = ++dashboardRequest;
    const promise = (async () => {
      try {
        const dashboard = await paperclipApi.request<Dashboard>("dashboard", id);
        if (current === generation && request === dashboardRequest) set({ dashboard, statusUpdatedAt: Date.now(), statusError: null });
      } catch (error) {
        if (current === generation && request === dashboardRequest) set({ statusError: message(error) });
      } finally {
        if (statusFlight?.generation === current) statusFlight = null;
      }
    })();
    statusFlight = { generation: current, promise };
    return promise;
  },
  refresh: () => {
    const state = get();
    if (!state.connected || !state.companyId) return Promise.resolve();
    if (refreshFlight?.generation === generation) return refreshFlight.promise;
    const current = generation;
    const id = state.companyId;
    const request = ++dashboardRequest;
    set({ loading: true, error: null });
    const promise = (async () => {
      try {
        const [agents, projects, issues, runs, dashboard, service] = await Promise.allSettled([
          paperclipApi.request<Agent[]>("agents", id), paperclipApi.request<Project[]>("projects", id),
          paperclipApi.request<Issue[]>("issues", id), paperclipApi.request<Run[]>("runs", id),
          paperclipApi.request<Dashboard>("dashboard", id), paperclipApi.service("status"),
        ]);
        if (current !== generation) return;
        if (request === dashboardRequest && dashboard.status === "fulfilled") {
          set({ dashboard: dashboard.value, statusUpdatedAt: Date.now(), statusError: null });
        } else if (request === dashboardRequest && dashboard.status === "rejected") {
          set({ statusError: message(dashboard.reason) });
        }
        // Required collections move together. On a connection failure preserve
        // the previous snapshot and its timestamp rather than showing zeroes.
        if (agents.status === "rejected") throw agents.reason;
        if (projects.status === "rejected") throw projects.reason;
        if (issues.status === "rejected") throw issues.reason;
        set({ agents: agents.value, projects: projects.value, issues: issues.value,
          runs: runs.status === "fulfilled" ? runs.value : [],
          ...(service.status === "fulfilled" ? { service: service.value } : {}),
          sectionErrors: [runs, dashboard, service].flatMap((r) => r.status === "rejected" ? [message(r.reason)] : []),
          updatedAt: Date.now() });
      } catch (error) {
        if (current === generation) set({ error: message(error) });
        throw error;
      } finally {
        if (current === generation) set({ loading: false });
        if (refreshFlight?.generation === current) refreshFlight = null;
      }
    })();
    refreshFlight = { generation: current, promise };
    return promise;
  },
  mutate: async (key, action) => {
    if (get().busy) throw new Error("Another Paperclip operation is still running");
    if (!get().connected) throw new Error("Connect to Paperclip first");
    const current = generation;
    set({ busy: key, error: null });
    try {
      const result = await action();
      // Mutation receipt and list refresh have different outcomes: a saved
      // task stays saved even if refreshing the dashboard subsequently fails.
      if (current === generation) {
        await refreshFlight?.promise?.catch(() => {});
        await get().refresh().catch(() => {});
      }
      return result;
    } catch (error) {
      if (current === generation) set({ error: message(error) });
      throw error;
    } finally { if (current === generation) set({ busy: null }); }
  },
  controlService: async (action, config) => {
    if (get().busy) throw new Error("Another Paperclip operation is still running");
    set({ busy: "service", error: null });
    try {
      const service = await paperclipApi.service(action, config);
      set({ service, ...(action === "start" && config ? { config } : {}) });
    } catch (error) { set({ error: message(error) }); throw error; }
    finally { set({ busy: null }); }
  },
}));
