import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ config: vi.fn(), connect: vi.fn(), request: vi.fn(), service: vi.fn() }));
const external = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ paperclipApi: api }));
vi.mock("@/lib/platform", () => ({ isWeb: false, IS_MAC: true, openExternal: external }));
import i18n from "@/lib/i18n";
import { PaperclipTeam } from "./PaperclipTeam";
import { usePaperclipStore } from "./store";
import type { Issue } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
const config = { port: 3100, sourceDir: "/paperclip", dataDir: "/data", nodePath: "/node", pnpmPath: "/pnpm", keepAwake: false };
const issue: Issue = { id: "task-one", identifier: "TEAM-1", title: "First task", description: "Description", status: "todo", priority: "medium", assigneeAgentId: null, projectId: null, updatedAt: new Date().toISOString() };
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const render = async () => { await act(async () => { root.render(<PaperclipTeam />); }); };
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.removeItem("paperclip:overview-expanded");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  await i18n.changeLanguage("en");
  usePaperclipStore.setState({ open: true, active: true, initialized: true, connected: true, config,
    service: { supported: true, installed: false, running: false }, companies: [{ id: "company", name: "Team", status: "active" }],
    companyId: "company", agents: [], projects: [], issues: [issue], runs: [], dashboard: null, view: "tasks", search: "", projectId: "",
    selectedIssueId: null, busy: null, loading: false, error: null, sectionErrors: [], updatedAt: Date.now() });
  api.request.mockImplementation(async (action) => action === "issue" ? issue : action === "dashboard" ? null : []);
  api.service.mockResolvedValue({ supported: true, installed: false, running: false });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("requires explicit service enablement and preserves the selected data home", async () => {
  await render();
  await act(async () => button("Connection").click());
  expect(api.service).not.toHaveBeenCalled();
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  expect(api.service).not.toHaveBeenCalled();
  await act(async () => button("Enable background service").click());
  expect(api.service).toHaveBeenCalledWith("start", { ...config, keepAwake: true });
  expect(host.textContent).toContain("Closing the lid can still put your Mac to sleep");
});

it("renders untrusted task Markdown without scripts or remote image requests", async () => {
  api.request.mockImplementation(async (action) => action === "issue" ? { ...issue, description: '<script>alert(1)</script>\n\n![Tracker](https://example.com/track.png)\n\n[Reference](https://example.com/docs)' } : []);
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>(".pc-task-row")!.click());
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector("img")).toBeNull();
  const link = host.querySelector<HTMLAnchorElement>('.pc-markdown a')!;
  await act(async () => link.click());
  expect(external).toHaveBeenCalledWith("https://example.com/docs");
});

it("does not show a late task detail in a newly selected task", async () => {
  let resolve!: (value: Issue) => void;
  const pending = new Promise<Issue>((r) => { resolve = r; });
  const second = { ...issue, id: "task-two", identifier: "TEAM-2", title: "Second task" };
  usePaperclipStore.setState({ issues: [issue, second] });
  api.request.mockImplementation(async (action, id) => action === "issue" ? id === issue.id ? pending : second : []);
  await render();
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".pc-task-row")[0].click());
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".pc-task-row")[1].click());
  await act(async () => resolve(issue));
  expect(host.querySelector(".pc-detail h2")?.textContent).toBe("Second task");
});

it("clears polling when the team page is unmounted", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => root.render(<div />));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(api.request).not.toHaveBeenCalled();
  expect(api.service).not.toHaveBeenCalled();
});

it("preserves a task draft across tab switches while stopping hidden polling", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => button("New task").click());
  const input = host.querySelector<HTMLInputElement>(".pc-new-task input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Keep this draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.render(<PaperclipTeam visible={false} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(api.request).not.toHaveBeenCalled();
  await act(async () => root.render(<PaperclipTeam visible />));
  expect(host.querySelector<HTMLInputElement>(".pc-new-task input")?.value).toBe("Keep this draft");
});

it("disables a reply draft while a write is pending", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>(".pc-task-row")!.click());
  await act(async () => usePaperclipStore.setState({ busy: "comment:task-one" }));
  expect(host.querySelector<HTMLTextAreaElement>(".pc-reply textarea")?.disabled).toBe(true);
  expect(button("Send").disabled).toBe(true);
});

it("keeps the overview collapsed by default and remembers the choice across tabs and remounts", async () => {
  await render();
  expect(host.querySelector(".pc-overview")?.hasAttribute("hidden")).toBe(true);
  const toggle = () => host.querySelector<HTMLButtonElement>('[aria-controls]')!;
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle().click());
  expect(host.querySelector(".pc-overview")?.hasAttribute("hidden")).toBe(false);
  expect(document.getElementById(toggle().getAttribute("aria-controls")!)).toBe(host.querySelector(".pc-overview"));
  expect(localStorage.getItem("paperclip:overview-expanded")).toBe("true");
  await act(async () => button(i18n.t("paperclip.activity")).click());
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  await act(async () => root.render(<div />));
  await render();
  expect(host.querySelector(".pc-overview")?.hasAttribute("hidden")).toBe(false);
  await act(async () => toggle().click());
  expect(localStorage.getItem("paperclip:overview-expanded")).toBe("false");
  expect(host.querySelector(".pc-overview")?.hasAttribute("hidden")).toBe(true);
});
