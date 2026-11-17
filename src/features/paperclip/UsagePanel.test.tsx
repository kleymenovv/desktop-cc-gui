import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn(), codexLimits: vi.fn() }));
const consent = vi.hoisted(() => vi.fn((op: () => Promise<unknown>) => op()));
vi.mock("./api", () => ({ paperclipApi: api }));
vi.mock("@/lib/credential-consent", () => ({ withCredentialConsent: consent }));
vi.mock("./AgentPortrait", () => ({ AgentPortrait: () => <span /> }));
import i18n from "@/lib/i18n";
import { QuotaPanel, UsagePanel, remainingPercent, totalTokens, usagePeriod } from "./UsagePanel";
import { usePaperclipStore } from "./store";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const render = async (node: React.ReactNode) => { await act(async () => { root.render(node); }); };
const click = async (label: string) => { await act(async () => { Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!.click(); }); };
const cost = { agentId: "a", agentName: "Engineer", costCents: 0, inputTokens: 100, cachedInputTokens: 50, outputTokens: 20, eventCount: 1, estimatedEventCount: 0, unpricedEventCount: 1, apiRunCount: 0, subscriptionRunCount: 1 };
beforeEach(async () => {
  vi.resetAllMocks(); await i18n.changeLanguage("en");
  usePaperclipStore.setState({ companyId: "company", agents: [{ id: "a", name: "Engineer", role: "engineer", title: null, status: "idle", adapterType: "codex_local", reportsTo: null, budgetMonthlyCents: 0, spentMonthlyCents: 0 }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  api.request.mockImplementation(async (action) => action === "costByAgent" ? [cost] : []);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("never treats unknown quota as unused, and clamps reported percentages", () => {
  expect(remainingPercent(null)).toBeNull(); expect(remainingPercent(NaN)).toBeNull();
  expect(remainingPercent(25)).toBe(75); expect(remainingPercent(110)).toBe(0);
  expect(totalTokens(cost)).toBe(170);
  expect(usagePeriod("month", new Date("2026-11-17T12:00:00Z"))).toEqual({ from: "2026-11-01T00:00:00.000Z", to: "2026-11-17T12:00:00.000Z" });
});
it("never probes credentials or provider quota on mount, polling or visibility changes", async () => {
  vi.useFakeTimers(); await render(<QuotaPanel visible />);
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); document.dispatchEvent(new Event("visibilitychange")); });
  await render(<QuotaPanel visible={false} />);
  expect(api.request).not.toHaveBeenCalled(); expect(api.codexLimits).not.toHaveBeenCalled(); expect(consent).not.toHaveBeenCalled();
});
it("shows true account remaining and unavailable windows after an explicit check", async () => {
  api.request.mockResolvedValue([{ provider: "openai", ok: true, accountLabel: "Team account", windows: [{ label: "5h", usedPercent: 36, resetsAt: null, valueLabel: null }, { label: "7d", usedPercent: null, resetsAt: null, valueLabel: null }] }]);
  await render(<QuotaPanel visible />); await click("Check account limits");
  expect(api.request).toHaveBeenCalledWith("quotaWindows", "company");
  expect(host.textContent).toContain("64% left"); expect(host.textContent).not.toContain("100% left");
  expect(host.querySelectorAll('[role="meter"]')).toHaveLength(1);
});
it("uses the existing credential consent flow only for the local Codex action", async () => {
  api.codexLimits.mockResolvedValue({ providers: [{ id: "codex", status: "ok", plan: "Pro", fetchedAt: Date.now(), windows: [{ id: "session", kind: "session", usedPercent: 80, resetsAt: Date.now() + 100000 }] }] });
  await render(<QuotaPanel visible />); await click("Local Codex");
  expect(consent).toHaveBeenCalledTimes(1); expect(api.codexLimits).toHaveBeenCalledTimes(1);
  expect(api.request).not.toHaveBeenCalled(); expect(host.textContent).toContain("20% left");
});
it("discards a quota result when its view becomes hidden", async () => {
  let resolve!: (value: unknown) => void;
  api.request.mockImplementation(() => new Promise((r) => { resolve = r; }));
  await render(<QuotaPanel visible />);
  await act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Check account limits")!.click(); });
  await render(<QuotaPanel visible={false} />);
  await act(async () => resolve([{ provider: "openai", ok: true, accountLabel: "Late account", windows: [] }]));
  expect(host.textContent).not.toContain("Late account");
});
it("shows missing run usage as unknown and subscription tokens despite zero dollars", async () => {
  api.request.mockImplementation(async (action) => action === "costByAgent" ? [cost] : [{ id: "run", agentId: "a", status: "succeeded", startedAt: new Date().toISOString(), createdAt: new Date().toISOString(), costUsd: null, inputTokens: 123, outputTokens: null }]);
  await render(<UsagePanel visible agentId="a" onAgentChange={() => {}} />);
  expect(api.request).toHaveBeenCalledWith("usageRuns", "company", { agentId: "a" });
  expect(host.textContent).toContain("170"); expect(host.textContent).toContain("Some usage has no price");
  expect(host.textContent).toContain("Input: 123"); expect(host.textContent).toContain("Output: —");
  expect(host.textContent).toContain("Cost unavailable");
});
it("reports read failures without manufacturing zero usage, and stops hidden polling", async () => {
  vi.useFakeTimers(); api.request.mockRejectedValue(new Error("Paperclip unavailable"));
  await render(<UsagePanel visible agentId="" onAgentChange={() => {}} />);
  expect(host.textContent).toContain("Paperclip unavailable");
  expect(host.querySelector('.pc-usage-totals')?.textContent).not.toContain("$0.00");
  await render(<UsagePanel visible={false} agentId="" onAgentChange={() => {}} />);
  const calls = api.request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
  expect(api.request).toHaveBeenCalledTimes(calls);
});
it("keeps failed account checks visible and never invents full remaining quota", async () => {
  api.request.mockResolvedValue([{ provider: "openai", ok: false, errorFamily: "credentials_unavailable", windows: [] }]);
  await render(<QuotaPanel visible />); await click("Check account limits");
  expect(host.textContent).toContain("Connect a subscription account in Paperclip AI connections.");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="meter"]')).toBeNull();
});
