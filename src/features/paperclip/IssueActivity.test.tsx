import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ paperclipApi: api }));
vi.mock("./AgentPortrait", () => ({ AgentPortrait: () => <span /> }));
import i18n from "@/lib/i18n";
import { IssueActivity } from "./IssueActivity";
import { mergeActivity } from "./activity";
import { usePaperclipStore } from "./store";
import type { ActivityEvent, LiveRun } from "./api";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const run: LiveRun = { id: "run-one", agentId: "agent-one", agentName: "Engineer", status: "running", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null, error: null, errorCode: null };
const event = (seq: number, text: string, patch: Partial<ActivityEvent> = {}): ActivityEvent => ({ seq, itemId: "message-one", kind: "message", eventType: "item.delta", text, name: null, status: "running", time: run.createdAt, delta: true, ...patch });
const render = async (id = "issue-one", visible = true) => { await act(async () => root.render(<IssueActivity id={id} visible={visible} />)); };
beforeEach(async () => {
  vi.resetAllMocks(); vi.useFakeTimers(); await i18n.changeLanguage("en");
  usePaperclipStore.setState({ agents: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [run] : action === "issueExecution" ? { runId: run.id } : action === "runStatus" ? run : { events: [], nextSeq: 0, hasMore: false });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("assembles Chinese and emoji deltas and prefers the authoritative completion without duplication", () => {
  let rows = mergeActivity([], [event(1, "你🙂"), event(2, "好", { kind: "item" })]);
  expect(rows[0].text).toBe("你🙂好");
  rows = mergeActivity(rows, [event(3, "你🙂好!", { delta: false, status: "completed" }), event(4, "duplicate")]);
  expect(rows).toHaveLength(1); expect(rows[0].text).toBe("你🙂好!");
});
it("merges tool lifecycles by identity and bounds retained history and long Unicode text", () => {
  let rows = mergeActivity([], [event(1, "", { itemId: "tool", kind: "tool", name: "Read" }), event(2, "", { itemId: "tool", kind: "tool", status: "failed", name: null })]);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ name: "Read", status: "failed" });
  rows = mergeActivity(rows, Array.from({ length: 210 }, (_, i) => event(i + 3, "x", { itemId: `m${i}` })));
  expect(rows).toHaveLength(200);
  const long = mergeActivity([], [event(1, "🙂".repeat(16001))])[0];
  expect(Array.from(long.text)).toHaveLength(16000); expect(long.truncated).toBe(true);
});
it("shows real live messages and safe tool statuses while escaping untrusted text", async () => {
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [run] : action === "issueExecution" ? null : { events: [event(1, '<img src="x" onerror="alert(1)">'), event(2, "", { itemId: "tool", kind: "tool", name: "site import crawl", status: "failed" })], nextSeq: 2, hasMore: false });
  await render(); expect(host.textContent).toContain("Working"); expect(host.textContent).toContain("site import crawl"); expect(host.textContent).toContain("Failed"); expect(host.querySelector("img")).toBeNull();
});
it("reads the final event page when a live run finishes instead of freezing its previous snapshot", async () => {
  let finished = false;
  api.request.mockImplementation(async (action, _id, body) => {
    if (action === "issueLiveRuns") return finished ? [] : [run];
    if (action === "issueExecution") return { runId: run.id };
    if (action === "runStatus") return { ...run, status: "succeeded", finishedAt: new Date().toISOString() };
    return { events: body.afterSeq === 0 ? [event(1, "Preparing")] : [event(2, "Finished correctly", { delta: false, status: "completed" })], nextSeq: body.afterSeq === 0 ? 1 : 2, hasMore: false };
  });
  await render(); expect(host.textContent).toContain("Preparing"); finished = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(host.textContent).toContain("Finished correctly"); expect(host.textContent).not.toContain("Preparing"); expect(host.textContent).toContain("Completed");
});
it("discards late events on task switches and never imports another task from the same agent", async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementation(async (action, id) => {
    if (action === "issueLiveRuns") return id === "issue-one" ? [run] : [];
    if (action === "issueExecution") return null;
    return new Promise((resolve) => { finish = resolve; });
  });
  await render(); await render("issue-two");
  await act(async () => finish({ events: [event(1, "Old task private text")], nextSeq: 1, hasMore: false }));
  expect(host.textContent).not.toContain("Old task private text"); expect(host.textContent).toContain("No active run");
});
it("pauses hidden reads and resumes at the saved cursor without replaying text", async () => {
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [run] : action === "issueExecution" ? null : { events: [event(1, "Hello")], nextSeq: 1, hasMore: false });
  await render(); await render("issue-one", false); const calls = api.request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(api.request).toHaveBeenCalledTimes(calls);
  await render(); expect(api.request).toHaveBeenLastCalledWith("runEvents", run.id, { afterSeq: 1 });
  expect(host.textContent?.match(/Hello/g)).toHaveLength(1);
});
it("retains the last feed on failures and resumes at its acknowledged sequence", async () => {
  let fail = false;
  api.request.mockImplementation(async (action) => {
    if (action === "issueLiveRuns") return [run]; if (action === "issueExecution") return null;
    if (fail) throw new Error("Connection interrupted");
    return { events: [event(1, "Still recorded")], nextSeq: 1, hasMore: false };
  });
  await render(); fail = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(host.textContent).toContain("Connection interrupted"); expect(host.textContent).toContain("Still recorded");
  expect(api.request).toHaveBeenLastCalledWith("runEvents", run.id, { afterSeq: 1 });
});
it("reports idle state even when the agent is busy elsewhere", async () => {
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [] : null);
  await render(); expect(host.textContent).toContain("No active run"); expect(api.request.mock.calls.some(([action]) => action === "runEvents")).toBe(false);
});
it("shows queued runs as waiting rather than pretending they are already working", async () => {
  api.request.mockImplementation(async (action) => action === "issueLiveRuns" ? [{ ...run, status: "queued" }] : action === "issueExecution" ? null : { events: [], nextSeq: 0, hasMore: false });
  await render(); expect(host.textContent).toContain("Waiting for the agent to start"); expect(host.textContent).not.toContain("Working now");
});
