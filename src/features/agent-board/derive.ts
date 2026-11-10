import type { Message, TodoItem } from "@/lib/ipc";
import type { SessionState } from "@/features/chat/store/stream";
import { sessionKey, type ActiveSession } from "@/features/chat/store/persistence";
import { PLAN_REVIEW_ROLE } from "@/features/chat/store/plan-review";
import { deriveEditedFiles, deriveTodoList } from "@/features/chat/components/agent-task-steps";

/**
 * Pure derivation of an agent board card from one session's loaded state.
 * Everything here is already in the chat store — the board adds no new
 * source of truth, so a card can never disagree with the session it opens.
 */

export type AgentStatus = "waiting" | "running" | "error" | "done" | "idle";

/** What the agent is blocked on, in the order the user should handle it. */
export type AgentAsk =
  | { kind: "grant"; seq: number; text: string; path: string | null }
  | { kind: "question"; text: string }
  | { kind: "plan" };

/** What a running agent is doing right now. */
export type AgentActivity =
  | { kind: "tool"; tool: string; detail: string | null }
  | { kind: "thinking" }
  | { kind: "writing" };

export interface AgentTimelineEntry {
  seq: number;
  ts: string | null;
  tool: string;
  detail: string | null;
}

/** The message-derived half of a card. Cached per `messages` array: only the
 *  streaming session gets a new array per flush, the others reuse theirs. */
export interface AgentSessionDigest {
  /** First user prompt, whitespace-collapsed — the task as originally given. */
  task: string | null;
  ask: AgentAsk | null;
  activity: AgentActivity | null;
  todos: TodoItem[];
  todoDone: number;
  todoCurrent: string | null;
  editedFiles: string[];
  lastReply: string | null;
  /** Most recent tool calls, newest last. */
  timeline: AgentTimelineEntry[];
}

const TIMELINE_LIMIT = 8;

const digestCache = new WeakMap<Message[], AgentSessionDigest>();
/** Ask-only cache for the sidebar badge: it runs on every stream flush even
 *  with the board closed, so it must not pay for the full digest. */
const askCache = new WeakMap<Message[], AgentAsk | null>();

function cachedAsk(messages: Message[]): AgentAsk | null {
  const digest = digestCache.get(messages);
  if (digest) return digest.ask;
  if (askCache.has(messages)) return askCache.get(messages) ?? null;
  const ask = pendingAsk(messages);
  askCache.set(messages, ask);
  return ask;
}

export function digestSession(messages: Message[]): AgentSessionDigest {
  const cached = digestCache.get(messages);
  if (cached) return cached;
  const todos = deriveTodoList(messages);
  const current = todos.find((item) => item.status === "active") ?? null;
  const digest: AgentSessionDigest = {
    task: firstUserText(messages),
    ask: cachedAsk(messages),
    activity: currentActivity(messages),
    todos,
    todoDone: todos.filter((item) => item.status === "complete").length,
    todoCurrent: current?.content ?? null,
    editedFiles: deriveEditedFiles(messages),
    lastReply: lastAssistantText(messages),
    timeline: recentTools(messages),
  };
  digestCache.set(messages, digest);
  return digest;
}

/** Column a session belongs to. Waiting beats running: a turn parked on a
 *  permission card is still "streaming" but only the user can move it. */
export function agentStatus(input: {
  session: SessionState | undefined;
  digest: AgentSessionDigest | null;
  streaming: boolean;
  retrying: boolean;
  unseen: boolean;
}): AgentStatus {
  if (input.digest?.ask) return "waiting";
  if (input.streaming || input.retrying) return "running";
  if (input.session?.error) return "error";
  if (input.unseen) return "done";
  return "idle";
}

/** Open tabs whose agent is blocked on the user, in tab order — the board's
 *  "waiting" column and the sidebar badge count the same sessions. Runs on
 *  every store change, so it reads only the cached ask scan. */
export function waitingTabs(
  openTabs: ActiveSession[],
  bySession: Record<string, SessionState>,
): ActiveSession[] {
  return openTabs.filter((tab) => {
    const session = bySession[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)];
    return Boolean(session && session.messages.length > 0 && cachedAsk(session.messages));
  });
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstUserText(messages: Message[]): string | null {
  for (const message of messages) {
    if (message.role === "user" && message.text.trim()) return collapse(message.text);
  }
  return null;
}

function lastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant" && message.text.trim()) return message.text.trim();
  }
  return null;
}

function pendingAsk(messages: Message[]): AgentAsk | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "grant" && message.grant?.status === "pending") {
      return { kind: "grant", seq: message.seq, text: message.text, path: message.path ?? null };
    }
    if (message.role === "question" && message.question?.status === "pending") {
      const first = message.question.questions[0];
      return { kind: "question", text: first?.question ?? message.text };
    }
    if (message.role === PLAN_REVIEW_ROLE && message.planReview?.status === "awaiting_review") {
      return { kind: "plan" };
    }
  }
  return null;
}

function currentActivity(messages: Message[]): AgentActivity | null {
  const last = messages[messages.length - 1];
  if (!last) return null;
  if (last.role === "tool") return { kind: "tool", tool: last.text, detail: toolDetail(last) };
  if (last.role === "thinking") return { kind: "thinking" };
  if (last.role === "assistant") return { kind: "writing" };
  return null;
}

function recentTools(messages: Message[]): AgentTimelineEntry[] {
  const entries: AgentTimelineEntry[] = [];
  for (let i = messages.length - 1; i >= 0 && entries.length < TIMELINE_LIMIT; i--) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    entries.push({ seq: message.seq, ts: message.ts, tool: message.text, detail: toolDetail(message) });
  }
  return entries.reverse();
}

/** The one argument that says what a tool call touches: its file, else a
 *  shell command, else a search pattern or URL. */
function toolDetail(message: Message): string | null {
  if (message.path) return message.path;
  const args = message.args;
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const field of ["command", "cmd", "pattern", "query", "url", "description"]) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return collapse(value);
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
      return collapse(value.join(" "));
    }
  }
  return null;
}
