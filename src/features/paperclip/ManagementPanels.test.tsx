import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ config: vi.fn(), connect: vi.fn(), request: vi.fn(), service: vi.fn() }));
vi.mock("./api", () => ({ paperclipApi: api }));
import i18n from "@/lib/i18n";
import { usePaperclipStore } from "./store";
import { AgentEditor } from "./AgentEditor";
import { ProjectsPanel, GoalsPanel } from "./PlanningPanels";
import { ApprovalsPanel, RoutinesPanel } from "./AutomationPanels";
import { BudgetsPanel } from "./BudgetsPanel";
import { dollarCents, useManagementResource } from "./management";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
const company = "company-one";
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const field = (text: string) => Array.from(host.querySelectorAll("label")).find((label) => label.firstChild?.textContent === text)?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")!;
const change = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const submit = async (element: Element) => { await act(async () => element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
const agent = { id: "agent-one", name: "Engineer", role: "engineer", title: null, status: "idle", adapterType: "codex_local", reportsTo: null, budgetMonthlyCents: 0, spentMonthlyCents: 0 };
const configuration = { ...agent, capabilities: "Build things", configurationRevision: "a".repeat(64), adapterConfig: { model: "old-model", cwd: "/workspace" }, runtimeConfig: { heartbeat: { enabled: false, intervalSec: 300 } } };
beforeEach(async () => {
  vi.resetAllMocks(); await i18n.changeLanguage("en");
  usePaperclipStore.setState({ initialized: true, connected: true, companyId: company, companies: [{ id: company, name: "Team", status: "active" }], agents: [agent], projects: [], issues: [], runs: [], dashboard: null, busy: null, loading: false, error: null });
  api.service.mockResolvedValue({ supported: true, installed: false, running: false });
  api.request.mockImplementation(async (action) => action === "budgets" ? { policies: [], activeIncidents: [] } : action === "dashboard" ? null : action === "agentConfiguration" ? configuration : []);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("converts decimal USD exactly and rejects fractional cents and overflow", () => {
  expect(dollarCents("100.01")).toBe(10001);
  expect(dollarCents("0,09")).toBe(9);
  for (const value of ["1.001", "1e3", "-1", "NaN", "21474836.48", ""]) expect(dollarCents(value)).toBeNull();
});

it("creates a project and its primary workspace in one idempotent request", async () => {
  api.request.mockImplementation(async (action) => action === "createProject" ? { id: "project-created" } : action === "dashboard" ? null : []);
  await render(<ProjectsPanel visible onOpen={() => {}} />);
  await act(async () => button("New project").click());
  await change(field("Name"), "Workspace project");
  await change(field("Local workspace folder"), "/workspace");
  await submit(host.querySelector("form")!);
  const call = api.request.mock.calls.find(([action]) => action === "createProject")!;
  expect(call[1]).toBe(company);
  expect(call[2]).toMatchObject({ name: "Workspace project", workspace: { cwd: "/workspace", sourceType: "local_path", isPrimary: true }, idempotencyKey: expect.any(String) });
});

it("sends only changed adapter fields with the original agent revision", async () => {
  await render(<AgentEditor id={agent.id} visible onClose={() => {}} />);
  expect(api.request.mock.calls.some(([action]) => action === "agentInstructions")).toBe(false);
  await change(field("Default model"), "new-model");
  await submit(host.querySelector("form")!);
  const body = api.request.mock.calls.find(([action]) => action === "updateAgent")![2];
  expect(body.adapterConfig).toEqual({ model: "new-model" });
  expect(body.expectedConfigurationRevision).toBe(configuration.configurationRevision);
  expect(body).not.toHaveProperty("runtimeConfig");
  expect(body).not.toHaveProperty("permissions");
});

it("retains an instruction draft when the server rejects its stale revision", async () => {
  api.request.mockImplementation(async (action) => {
    if (action === "agentConfiguration") return configuration;
    if (action === "agentInstructions") return { entryFile: "AGENTS.md", resolvedEntryPath: "/managed/AGENTS.md" };
    if (action === "agentInstructionFile") return { path: "AGENTS.md", content: "Original", editable: true, contentHash: "b".repeat(64), revision: { id: "revision-one" } };
    if (action === "saveAgentInstructions") throw new Error("Revision conflict");
    return [];
  });
  await render(<AgentEditor id={agent.id} visible onClose={() => {}} />);
  await act(async () => button("Load agent instructions").click());
  const textarea = host.querySelector<HTMLTextAreaElement>('.pc-schedule-editor textarea')!;
  await change(textarea, "Keep this instruction draft");
  await submit(host.querySelector('.pc-schedule-editor form')!);
  expect(textarea.value).toBe("Keep this instruction draft");
  expect(usePaperclipStore.getState().error).toBe("Revision conflict");
  expect(api.request.mock.calls.find(([action]) => action === "saveAgentInstructions")![2]).toMatchObject({ baseHash: "b".repeat(64), baseRevisionId: "revision-one" });
});

it("does not approve anything until the user reviews a request and acts", async () => {
  const approval = { id: "approval-one", type: "request_board_approval", status: "pending", requestedByAgentId: agent.id, payload: { title: "Publish release", password: "must-not-render" }, decisionNote: null, createdAt: new Date().toISOString() };
  api.request.mockImplementation(async (action) => action === "approvals" ? [approval] : action === "dashboard" ? null : []);
  await render(<ApprovalsPanel visible onOpen={() => {}} />);
  expect(api.request.mock.calls.some(([action]) => action === "approve")).toBe(false);
  await act(async () => button("Publish release").click());
  expect(host.textContent).not.toContain("must-not-render");
  await change(field("Decision or feedback"), "Reviewed the requested release");
  await act(async () => button("Approve").click());
  expect(api.request.mock.calls.filter(([action]) => action === "approve")).toEqual([["approve", approval.id, { decisionNote: "Reviewed the requested release" }]]);
});

it("creates routines paused and keeps the saved routine after a schedule failure", async () => {
  const created = { id: "routine-one", title: "Daily review", description: "Review changes", status: "paused", assigneeAgentId: null, projectId: null, goalId: null, concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", priority: "medium", latestRevisionId: "revision-one", triggers: [] };
  api.request.mockImplementation(async (action) => {
    if (action === "createRoutine") return created;
    if (action === "createSchedule") throw new Error("Invalid cron");
    return action === "dashboard" ? null : [];
  });
  await render(<RoutinesPanel visible onOpen={() => {}} />);
  await act(async () => button("New routine").click());
  await change(field("Name"), "Daily review"); await change(field("Task instructions and expected result"), "Review changes");
  await submit(host.querySelector("form")!);
  expect(api.request.mock.calls.find(([action]) => action === "createRoutine")![2].status).toBe("paused");
  expect(api.request.mock.calls.some(([action]) => action === "createSchedule" || action === "runRoutine")).toBe(false);
  await submit(host.querySelector(".pc-schedule-editor form")!);
  expect(api.request.mock.calls.filter(([action]) => action === "createRoutine")).toHaveLength(1);
  expect(host.querySelector(".pc-schedule-editor form")).not.toBeNull();
  expect(usePaperclipStore.getState().error).toBe("Invalid cron");
});

it("saves budget cents without sending unrelated policy settings", async () => {
  await render(<BudgetsPanel visible />);
  await act(async () => button("New spending limit").click());
  await change(field("Limit, USD"), "100.01");
  await submit(host.querySelector("form")!);
  expect(api.request.mock.calls.find(([action]) => action === "saveBudget")![2]).toEqual({ scopeType: "company", scopeId: company, metric: "billed_cents", windowKind: "calendar_month_utc", amount: 10001, warnPercent: 80, hardStopEnabled: true, unpricedUsagePolicy: "block", isActive: true });
});

it("updates an already saved schedule and ignores a canonical read after closing its editor", async () => {
  const created = { id: "routine-one", title: "Daily review", description: "Review changes", status: "paused", assigneeAgentId: null, projectId: null, goalId: null, concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", priority: "medium", latestRevisionId: "revision-one", triggers: [] };
  const trigger = { id: "trigger-one", kind: "schedule", enabled: true, cronExpression: "0 9 * * *", timezone: "UTC" };
  let resolve!: (value: unknown) => void;
  api.request.mockImplementation(async (action) => {
    if (action === "createRoutine") return created;
    if (action === "createSchedule") return { trigger };
    if (action === "updateSchedule") return trigger;
    if (action === "routine") return new Promise((r) => { resolve = r; });
    return action === "dashboard" ? null : [];
  });
  await render(<RoutinesPanel visible onOpen={() => {}} />);
  await act(async () => button("New routine").click());
  await change(field("Name"), "Daily review"); await change(field("Task instructions and expected result"), "Review changes");
  await submit(host.querySelector("form")!);
  await submit(host.querySelector(".pc-schedule-editor form")!);
  await submit(host.querySelector(".pc-schedule-editor form")!);
  expect(api.request.mock.calls.filter(([action]) => action === "createSchedule")).toHaveLength(1);
  expect(api.request.mock.calls.filter(([action]) => action === "updateSchedule")).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>(".pc-management-editor .pc-form-title button")!.click());
  await act(async () => resolve({ ...created, triggers: [trigger], latestRevisionId: "revision-two" }));
  expect(host.querySelector(".pc-management-editor")).toBeNull();
});

it("excludes goal descendants from parent choices", async () => {
  const base = { description: null, level: "team", status: "planned", ownerAgentId: null };
  api.request.mockResolvedValue([{ ...base, id: "parent", title: "Parent", parentId: null }, { ...base, id: "child", title: "Child", parentId: "parent" }]);
  await render(<GoalsPanel visible />);
  await act(async () => button("Edit").click());
  const options = field("Parent goal").querySelectorAll("option");
  expect(Array.from(options).filter((option) => option.textContent?.trim()).map((option) => option.textContent)).toEqual(["No linked goal"]);
});

it("drops late management reads and stops polling when hidden", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown[]) => void;
  api.request.mockImplementation(() => new Promise<unknown[]>((r) => { resolve = r; }));
  function Probe({ visible }: { visible: boolean }) { const resource = useManagementResource<unknown[]>("goals", visible); return <span>{JSON.stringify(resource.data)}</span>; }
  await render(<Probe visible />);
  await render(<Probe visible={false} />);
  await act(async () => { resolve(["late"]); await vi.advanceTimersByTimeAsync(30_000); });
  expect(host.textContent).toBe("null");
  expect(api.request).toHaveBeenCalledTimes(1);
});
