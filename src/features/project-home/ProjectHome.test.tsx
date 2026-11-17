import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn(), service: vi.fn() }));
vi.mock("@/features/paperclip/api", () => ({ paperclipApi: api }));
vi.mock("@/features/paperclip/use-sidebar-status", () => ({ useSidebarStatus: () => {} }));
vi.mock("@/features/git/ChangesPanel", () => ({ ChangesPanel: () => <div>Git panel</div> }));
import i18n from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { usePaperclipStore } from "@/features/paperclip/store";
import { useProjectHomeStore } from "./store";
import { ProjectHome } from "./ProjectHome";
let host: HTMLDivElement; let root: Root;
const path = "/code/app";
const config = { port: 3100, sourceDir: "", dataDir: "", nodePath: "", pnpmPath: "", keepAwake: false };
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
const session = (id: string, workspacePath: string) => ({ engine: "codex", sessionId: id, workspacePath, title: id, customTitle: null, updatedAt: 1234 });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useProjectHomeStore.setState({ paths: [path], activePath: path, bindings: {} });
  useChatStore.setState({ workspaces: [{ id: "ws", path, name: "app" } as never], workspaceAliases: {}, sessions: [session("my-session", path), session("other-session", "/code/other")] as never, openTabs: [], bySession: {}, streamingByKey: {}, retryingByKey: {}, unseen: {} });
  usePaperclipStore.setState({ connected: true, config, companyId: "company", companies: [], projects: [{ id: "project", name: "Team project", status: "active", primaryWorkspace: { cwd: path } }], agents: [], issues: [{ id: "task", projectId: "project", identifier: "APP-1", title: "Project task", status: "todo", priority: "medium" }, { id: "other", projectId: "elsewhere", title: "Other task", status: "todo", priority: "medium" }] as never, error: null, busy: null, refresh: vi.fn().mockResolvedValue(undefined) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("shows only the current project's tasks and sessions", async () => {
  await act(async () => root.render(<ProjectHome path={path} visible />));
  expect(host.textContent).toContain("Project task"); expect(host.textContent).not.toContain("Other task");
  await act(async () => button("Sessions").click());
  expect(host.textContent).toContain("my-session"); expect(host.textContent).not.toContain("other-session");
});
it("keeps a new-task draft across section switches and scopes its submission", async () => {
  api.request.mockResolvedValue({ id: "new-task" });
  await act(async () => root.render(<ProjectHome path={path} visible />));
  await act(async () => button(i18n.t("paperclip.newTask")).click());
  const input = host.querySelector<HTMLInputElement>(".pc-new-task input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fix navigation");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Sessions").click());
  await act(async () => button("Tasks").click());
  expect(host.querySelector<HTMLInputElement>(".pc-new-task input")!.value).toBe("Fix navigation");
  await act(async () => host.querySelector(".pc-new-task")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(api.request).toHaveBeenCalledWith("createIssue", "company", expect.objectContaining({ title: "Fix navigation", projectId: "project" }));
});
it("keeps local sessions available while Paperclip is disconnected", async () => {
  usePaperclipStore.setState({ connected: false });
  await act(async () => root.render(<ProjectHome path={path} visible />));
  expect(host.textContent).toContain(i18n.t("projectHome.noTeamTitle"));
  await act(async () => button("Sessions").click());
  expect(host.textContent).toContain("my-session");
  expect(api.request).not.toHaveBeenCalled();
});
it("reads files only after opening the files section and drops a late directory result", async () => {
  const list = vi.spyOn(ipc, "listDir");
  let resolve!: (value: never[]) => void;
  list.mockReturnValue(new Promise((r) => { resolve = r; }));
  await act(async () => root.render(<ProjectHome path={path} visible />));
  expect(list).not.toHaveBeenCalled();
  await act(async () => button("Files & Git").click());
  expect(list).toHaveBeenCalledWith(path);
  await act(async () => button("Sessions").click());
  await act(async () => resolve([{ name: "late-file", isDir: false }] as never[]));
  expect(host.textContent).not.toContain("late-file");
});


it("reads actual team runs only when a task is expanded in sessions", async () => {
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [] : null);
  await act(async () => root.render(<ProjectHome path={path} visible />));
  await act(async () => button("Sessions").click());
  expect(api.request).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>(".ph-team-sessions .ph-session")!.click());
  expect(api.request).toHaveBeenCalledWith("issueLiveRuns", "task");
  expect(api.request).toHaveBeenCalledWith("issueExecution", "task");
  expect(api.request.mock.calls.every(([, id]) => id === "task")).toBe(true);
});
