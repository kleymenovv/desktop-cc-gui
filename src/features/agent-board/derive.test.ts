import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ipc";
import type { SessionState } from "@/features/chat/store/stream";
import { agentStatus, digestSession, waitingTabs } from "./derive";

let seq = 0;
const msg = (role: string, text: string, extra: Partial<Message> = {}): Message => ({
  seq: ++seq,
  role,
  text,
  ts: null,
  ...extra,
});

const session = (messages: Message[], extra: Partial<SessionState> = {}) =>
  ({ messages, error: null, streaming: false, ...extra }) as unknown as SessionState;

const status = (messages: Message[], flags: Partial<Parameters<typeof agentStatus>[0]> = {}) =>
  agentStatus({
    session: session(messages),
    digest: digestSession(messages),
    streaming: false,
    retrying: false,
    unseen: false,
    ...flags,
  });

describe("agent board digest", () => {
  it("takes the task from the first non-empty user message", () => {
    const digest = digestSession([
      msg("user", "  "),
      msg("user", "Fix the\n  tab crash"),
      msg("user", "and add a test"),
    ]);
    expect(digest.task).toBe("Fix the tab crash");
  });

  it("reuses the digest while the messages array is unchanged", () => {
    const messages = [msg("user", "task")];
    expect(digestSession(messages)).toBe(digestSession(messages));
    expect(digestSession([...messages])).not.toBe(digestSession(messages));
  });

  it("reports the running tool with its command or file", () => {
    const bash = digestSession([
      msg("user", "run tests"),
      msg("tool", "Bash", { args: { command: "pnpm  exec vitest run" } }),
    ]);
    expect(bash.activity).toEqual({ kind: "tool", tool: "Bash", detail: "pnpm exec vitest run" });

    const edit = digestSession([msg("user", "edit"), msg("tool", "Edit", { path: "src/a.ts" })]);
    expect(edit.activity).toEqual({ kind: "tool", tool: "Edit", detail: "src/a.ts" });
    expect(digestSession([msg("thinking", "...")]).activity).toEqual({ kind: "thinking" });
  });

  it("keeps the last tool calls in order, newest last", () => {
    const messages = [msg("user", "go")];
    for (let i = 0; i < 12; i++) messages.push(msg("tool", `Read`, { path: `f${i}.ts` }));
    const timeline = digestSession(messages).timeline;
    expect(timeline).toHaveLength(8);
    expect(timeline[0].detail).toBe("f4.ts");
    expect(timeline[7].detail).toBe("f11.ts");
  });

  it("finds pending grants, questions and plan reviews, ignoring settled ones", () => {
    const grant = msg("grant", "Access denied", { path: "/etc/hosts", grant: { status: "pending" } });
    expect(digestSession([msg("user", "x"), grant]).ask).toEqual({
      kind: "grant",
      seq: grant.seq,
      text: "Access denied",
      path: "/etc/hosts",
    });
    expect(
      digestSession([msg("grant", "x", { grant: { status: "granted" } })]).ask,
    ).toBeNull();

    const question = msg("question", "", {
      question: {
        requestId: "r",
        runId: "u",
        status: "pending",
        questions: [{ question: "SQLite or a table?", header: "Storage", options: [] }],
      },
    });
    expect(digestSession([question]).ask).toEqual({ kind: "question", text: "SQLite or a table?" });

    const plan = msg("plan_review", "", {
      planReview: { status: "awaiting_review" } as Message["planReview"],
    });
    expect(digestSession([plan]).ask).toEqual({ kind: "plan" });
  });
});

describe("agent board status", () => {
  it("puts an agent blocked on the user in waiting even while its turn streams", () => {
    const messages = [msg("user", "x"), msg("grant", "denied", { grant: { status: "pending" } })];
    expect(status(messages, { streaming: true })).toBe("waiting");
  });

  it("orders running, error, done and idle", () => {
    const messages = [msg("user", "x")];
    expect(status(messages, { streaming: true })).toBe("running");
    expect(status(messages, { retrying: true })).toBe("running");
    expect(
      agentStatus({
        session: session(messages, { error: "boom" }),
        digest: digestSession(messages),
        streaming: false,
        retrying: false,
        unseen: true,
      }),
    ).toBe("error");
    expect(status(messages, { unseen: true })).toBe("done");
    expect(status(messages)).toBe("idle");
  });

  it("counts only open tabs as waiting", () => {
    const pending = [msg("user", "x"), msg("grant", "denied", { grant: { status: "pending" } })];
    const open = { engine: "claude", sessionId: "a", workspacePath: "/w" };
    const bySession = {
      "claude/a": session(pending),
      "claude/closed": session(pending),
      "claude/b": session([msg("user", "y")]),
    };
    const tabs = [open, { engine: "claude", sessionId: "b", workspacePath: "/w" }];
    expect(waitingTabs(tabs, bySession)).toEqual([open]);
  });
});
