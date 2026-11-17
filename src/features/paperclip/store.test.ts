import { beforeEach, expect, it, vi } from "vitest";
import type { PaperclipConfig } from "./api";

const api = vi.hoisted(() => ({ config: vi.fn(), connect: vi.fn(), request: vi.fn(), service: vi.fn() }));
vi.mock("./api", () => ({ paperclipApi: api }));
const config: PaperclipConfig = { port: 3100, sourceDir: "/paperclip", dataDir: "/data", nodePath: "/node", pnpmPath: "/pnpm", keepAwake: false };
let store: typeof import("./store").usePaperclipStore;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  store = (await import("./store")).usePaperclipStore;
  api.service.mockResolvedValue({ supported: true, installed: false, running: false });
  api.request.mockImplementation(async (action, id) => action === "dashboard" ? { companyId: id } : [{ id: `${id}-${action}` }]);
});

it("discards a previous organization's late snapshot and coalesces refreshes", async () => {
  const pending = deferred<unknown[]>();
  api.request.mockImplementation(async (action, id) => {
    if (id === "one" && action === "agents") return pending.promise;
    return action === "dashboard" ? { companyId: id } : [{ id: `${id}-${action}` }];
  });
  store.setState({ connected: true, companyId: "one", companies: [{ id: "one", name: "One", status: "active" }, { id: "two", name: "Two", status: "active" }] });
  const old = store.getState().refresh();
  expect(store.getState().refresh()).toBe(old);
  await store.getState().selectCompany("two");
  pending.resolve([{ id: "old-agent" }]);
  await old;
  expect(store.getState().companyId).toBe("two");
  expect(store.getState().agents[0].id).toBe("two-agents");
  expect(store.getState().loading).toBe(false);
});

it("keeps the last successful snapshot and timestamp when the network fails", async () => {
  store.setState({ connected: true, companyId: "one" });
  await store.getState().refresh();
  const previous = store.getState();
  api.request.mockRejectedValue(new Error("network unavailable"));
  await expect(store.getState().refresh()).rejects.toThrow("network unavailable");
  expect(store.getState().issues).toBe(previous.issues);
  expect(store.getState().updatedAt).toBe(previous.updatedAt);
  expect(store.getState().error).toBe("network unavailable");
  expect(store.getState().loading).toBe(false);
});

it("preserves a successful write receipt when refreshing afterward fails", async () => {
  store.setState({ connected: true, companyId: "one" });
  api.request.mockRejectedValue(new Error("refresh failed"));
  const action = vi.fn().mockResolvedValue({ id: "saved-task" });
  await expect(store.getState().mutate("create", action)).resolves.toEqual({ id: "saved-task" });
  expect(action).toHaveBeenCalledTimes(1);
  expect(store.getState().error).toBe("refresh failed");
  expect(store.getState().busy).toBeNull();
});

it("serializes writes, blocks organization changes during them, and never retries", async () => {
  store.setState({ connected: true, companyId: "one", companies: [{ id: "two", name: "Two", status: "active" }] });
  const pending = deferred<string>();
  const action = vi.fn(() => pending.promise);
  const first = store.getState().mutate("pause", action);
  const second = vi.fn();
  await expect(store.getState().mutate("stop", second)).rejects.toThrow("still running");
  await store.getState().selectCompany("two");
  expect(store.getState().companyId).toBe("one");
  expect(second).not.toHaveBeenCalled();
  pending.resolve("saved");
  await first;
  expect(action).toHaveBeenCalledTimes(1);
});

it("initializes once and does not contact a server before the first connection", async () => {
  api.config.mockResolvedValue({ config, configured: false, service: { supported: true, installed: false, running: false } });
  await Promise.all([store.getState().initialize(), store.getState().initialize()]);
  expect(api.config).toHaveBeenCalledTimes(1);
  expect(api.connect).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
  expect(store.getState().config).toEqual(config);
});

it("reports optional section failures without losing the working task list", async () => {
  store.setState({ connected: true, companyId: "one" });
  api.request.mockImplementation(async (action) => {
    if (action === "runs") throw new Error("Runs denied");
    if (action === "dashboard") throw new Error("Costs denied");
    return [{ id: action }];
  });
  await store.getState().refresh();
  expect(store.getState().issues[0].id).toBe("issues");
  expect(store.getState().sectionErrors).toEqual(["Runs denied", "Costs denied"]);
});


it("polls only dashboard metadata and preserves stale counts on failure", async () => {
  store.setState({ connected: true, companyId: "one" });
  await store.getState().refreshStatus();
  expect(api.request).toHaveBeenCalledExactlyOnceWith("dashboard", "one");
  expect(api.service).not.toHaveBeenCalled();
  expect(api.config).not.toHaveBeenCalled();
  const snapshot = store.getState();
  api.request.mockRejectedValue(new Error("offline"));
  await store.getState().refreshStatus();
  expect(store.getState().dashboard).toBe(snapshot.dashboard);
  expect(store.getState().statusUpdatedAt).toBe(snapshot.statusUpdatedAt);
  expect(store.getState().statusError).toBe("offline");
});

it("coalesces background polls and discards late results after company changes", async () => {
  const pending = deferred<unknown>();
  api.request.mockImplementation(async (action, id) => {
    if (action === "dashboard" && id === "one") return pending.promise;
    return action === "dashboard" ? { companyId: id } : [];
  });
  store.setState({ connected: true, companyId: "one", companies: [{ id: "two", name: "Two", status: "active" }] });
  const old = store.getState().refreshStatus();
  expect(store.getState().refreshStatus()).toBe(old);
  await store.getState().selectCompany("two");
  const current = store.getState().dashboard;
  pending.resolve({ companyId: "one" });
  await old;
  expect(store.getState().dashboard).toBe(current);
});

it("a newer full refresh wins over a slow sidebar poll", async () => {
  const pending = deferred<unknown>();
  api.request.mockImplementationOnce(() => pending.promise);
  store.setState({ connected: true, companyId: "one" });
  const old = store.getState().refreshStatus();
  await store.getState().refresh();
  const current = store.getState().dashboard;
  pending.resolve({ old: true });
  await old;
  expect(store.getState().dashboard).toBe(current);
});
