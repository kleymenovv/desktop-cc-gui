import type { UsageLimitsResult } from "@ccgui/plugin-sdk";
import { invoke } from "@/lib/transport";

export interface PaperclipConfig {
  port: number;
  sourceDir: string;
  dataDir: string;
  nodePath: string;
  pnpmPath: string;
  keepAwake: boolean;
}
export interface ServiceStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  logPath?: string;
  worker?: { online: boolean; ownership: "managed" | "external"; keepAwake: boolean; error: string | null } | null;
}
export interface Company { id: string; name: string; status: string; issuePrefix?: string }
export interface Agent {
  id: string; name: string; title: string | null; role: string; status: string;
  adapterType: string; reportsTo: string | null; budgetMonthlyCents: number; spentMonthlyCents: number;
  appearance?: { schemaVersion: number; characterVersion: string; paletteId: string; customAvatarAssetId?: string } | null;
  avatarUrl?: string | null;
}
export interface Project {
  id: string; name: string; status: string; description?: string | null;
  leadAgentId?: string | null; goalIds?: string[]; targetDate?: string | null;
  primaryWorkspace?: { cwd?: string | null } | null;
}
export interface Goal {
  id: string; title: string; description: string | null; level: string; status: string;
  parentId: string | null; ownerAgentId: string | null;
}
export interface AgentConfiguration extends Agent {
  capabilities: string | null; configurationRevision: string;
  adapterConfig: { model?: string; cwd?: string; thinkingEffort?: string };
  runtimeConfig: { heartbeat?: { enabled?: boolean; intervalSec?: number; [key: string]: unknown } };
}
export interface AgentInstructionFile {
  path: string; content: string; contentHash: string; editable: boolean;
  revision?: { id: string } | null;
}
export interface Approval {
  id: string; type: string; status: string; requestedByAgentId: string | null;
  payload: Record<string, unknown>; decisionNote: string | null; createdAt: string;
}
export interface Schedule {
  id: string; kind: string; enabled: boolean; cronExpression: string | null;
  timezone: string | null; nextRunAt?: string | null;
}
export interface Routine {
  id: string; title: string; description: string | null; status: string;
  projectId: string | null; goalId: string | null; assigneeAgentId: string | null;
  priority: string; latestRevisionId: string | null; triggers: Schedule[];
  concurrencyPolicy: string; catchUpPolicy: string;
  variables?: { name: string; required: boolean; defaultValue: unknown }[];
  activeIssue?: { id: string; identifier: string | null; title: string } | null;
}
export interface BudgetPolicy {
  policyId: string; scopeType: string; scopeId: string; scopeName: string;
  metric: string; windowKind: string; amount: number; observedAmount: number;
  utilizationPercent: number; warnPercent: number; hardStopEnabled: boolean;
  isActive: boolean; status: string; unpricedEventCount: number;
  unpricedUsagePolicy: "block" | "allow"; paused: boolean;
}
export interface BudgetOverview {
  policies: BudgetPolicy[];
  activeIncidents: { id: string; scopeName: string; status: string; thresholdType: string }[];
}
export interface Issue {
  id: string; identifier: string | null; title: string; description?: string | null;
  status: string; priority: string; assigneeAgentId: string | null; projectId: string | null;
  updatedAt: string;
}
export interface Run {
  id: string; agentId: string; status: string; startedAt: string | null; createdAt: string;
  usageJson?: { inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null } | null;
  costUsd?: number | null; inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null;
  finishedAt: string | null; error: string | null; errorCode: string | null;
}
export interface LiveRun extends Run {
  agentName?: string; currentStatusMessage?: string | null; currentToolName?: string | null;
  lastAssistantSnippet?: string | null; lastEventAt?: string | null; lastOutputAt?: string | null;
  livenessState?: string | null; nextAction?: string | null;
}
export interface ActivityEvent {
  seq: number; itemId: string; kind: "message" | "reasoning" | "tool" | "notice" | "error" | "item";
  eventType: string; text: string | null; name: string | null; status: string; time: string; delta: boolean;
}
export interface ActivityPage { events: ActivityEvent[]; nextSeq: number; hasMore: boolean }
export interface Comment { id: string; body: string; authorAgentId: string | null; authorUserId: string | null; createdAt: string }
export interface AgentCost {
  agentId: string | null; agentName: string | null; costCents: number;
  inputTokens: number; cachedInputTokens: number; outputTokens: number;
  eventCount: number; estimatedEventCount: number; unpricedEventCount: number;
  apiRunCount: number; subscriptionRunCount: number;
}
export interface QuotaAccount {
  provider: string; accountKey?: string; accountLabel?: string; capturedAt?: string;
  ok: boolean; errorFamily?: string | null; error?: string;
  windows: { label: string; usedPercent: number | null; resetsAt: string | null; valueLabel: string | null; detail?: string | null }[];
}
export interface Dashboard {
  agents: { active: number; running: number; paused: number; error: number };
  tasks: { open: number; inProgress: number; blocked: number; done: number };
  costs: { monthSpendCents: number; monthBudgetCents: number; monthUtilizationPercent: number };
  pendingApprovals: number;
}

export type PaperclipAction = "companies" | "agents" | "projects" | "issues" | "runs" | "dashboard"
  | "issue" | "comments" | "pauseAgent" | "resumeAgent" | "wakeAgent" | "stopRun"
  | "attachments" | "uploadAttachment" | "createIssue" | "updateIssue" | "comment" | "issueLiveRuns" | "issueExecution" | "runStatus" | "runEvents";
export type ManagementAction = "costByAgent" | "usageRuns" | "quotaWindows" | "goals" | "approvals" | "routines" | "routine" | "budgets" | "agentConfiguration"
  | "agentInstructions" | "agentInstructionFile" | "saveAgentInstructions"
  | "createAgent" | "updateAgent" | "createProject" | "updateProject" | "createGoal" | "updateGoal"
  | "approve" | "reject" | "requestRevision" | "createRoutine" | "updateRoutine" | "runRoutine"
  | "createSchedule" | "updateSchedule" | "saveBudget";

export const paperclipApi = {
  attachmentFile: (path: string) => invoke<{ name: string; base64: string }>("paperclip_attachment_file", { path }),
  codexLimits: () => invoke<UsageLimitsResult>("paperclip_codex_limits"),
  avatar: (palette: string | null, assetId: string | null, expectedPort: number) => invoke<string>("paperclip_avatar", { palette, assetId, expectedPort }),
  config: () => invoke<{ config: PaperclipConfig; configured: boolean; service: ServiceStatus }>("paperclip_config"),
  connect: (config: PaperclipConfig) => invoke<{ version?: string }>("paperclip_connect", { config }),
  request: <T>(action: PaperclipAction | ManagementAction, id?: string, body?: Record<string, unknown>) =>
    invoke<T>("paperclip_request", { action, id: id ?? null, body: body ?? null }),
  service: (action: "status" | "start" | "stop", config?: PaperclipConfig) =>
    invoke<ServiceStatus>("paperclip_service", { action, config: config ?? null }),
};
