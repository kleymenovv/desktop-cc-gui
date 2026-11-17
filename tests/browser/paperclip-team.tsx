import { ProjectHome } from "../../src/features/project-home/ProjectHome";
import { useProjectHomeStore } from "../../src/features/project-home/store";
import { ipc, type SessionMeta } from "../../src/lib/ipc";
// Production team UI against an in-memory Paperclip API. No native service,
// model, provider credentials or real task data are accessed by this fixture.
import { AgentBoardNavEntry, PaperclipNavEntry } from "../../src/components/application/ai-chat/agent-nav-entries";
import { useChatStore } from "../../src/features/chat/store";
import { sessionKey } from "../../src/features/chat/store/persistence";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import i18n from "../../src/lib/i18n";
import { PaperclipTeam } from "../../src/features/paperclip/PaperclipTeam";
import { usePaperclipStore } from "../../src/features/paperclip/store";
import { paperclipApi, type Agent, type Issue } from "../../src/features/paperclip/api";

const taskFiles = new Map<string, unknown[]>();
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
await i18n.changeLanguage(params.get("lang") ?? "ru");
const config = { port: 3100, sourceDir: "/Users/example/Projects/paperclip", dataDir: "/Users/example/Projects/paperclip/.paperclip-local/data", nodePath: "/opt/homebrew/bin/node", pnpmPath: "/opt/homebrew/bin/pnpm", keepAwake: true };
const agents: Agent[] = [
  { id: "lead", name: "Lead", title: "Планирование и координация", role: "ceo", status: "running", adapterType: "claude_local", reportsTo: null, budgetMonthlyCents: 10000, spentMonthlyCents: 1200 },
  { id: "engineer", name: "Engineer", title: "Разработка и исправления", role: "engineer", status: "running", adapterType: "codex_local", reportsTo: "lead", budgetMonthlyCents: 15000, spentMonthlyCents: 2350 },
  { id: "reviewer", name: "Reviewer", title: "Проверка изменений", role: "engineer", status: "idle", adapterType: "claude_local", reportsTo: "lead", budgetMonthlyCents: 5000, spentMonthlyCents: 750 },
  { id: "research", name: "Research", title: "Исследования и аналитика", role: "researcher", status: "paused", adapterType: "codex_local", reportsTo: "lead", budgetMonthlyCents: 5000, spentMonthlyCents: 500 },
];
const rows = [
  ["Подключить управление командой к рабочему пространству", "in_progress", "high", "engineer"],
  ["Проверить восстановление задач после перезапуска", "in_review", "high", "reviewer"],
  ["Подготовить план следующей итерации", "todo", "medium", "lead"],
  ["Уточнить критерии приёмки фоновой работы", "blocked", "critical", "lead"],
  ["Разобрать обратную связь по навигации", "todo", "low", "research"],
  ["Добавить историю запусков агентов", "done", "medium", "engineer"],
];
let issues: Issue[] = rows.map(([title, status, priority, assigneeAgentId], index) => ({ id: `task-${index + 1}`, identifier: `TEAM-${index + 1}`, title, status, priority, assigneeAgentId, projectId: "desktop", updatedAt: new Date().toISOString(), description: "## Ожидаемый результат\n\nУправление командой доступно в CC GUI. Задачи и история остаются в Paperclip.\n\n- Состояние обновляется без перезагрузки\n- Ошибки соединения видны пользователю\n- Фоновая работа не зависит от открытого окна\n\n```ts\nconst team = await paperclip.connect();\n```" }));
const projects = [{ id: "desktop", name: "CC GUI", status: "in_progress" }];
const service = { supported: true, installed: true, running: true, worker: { online: true, ownership: "external" as const, keepAwake: true, error: null }, logPath: "/Users/example/.ccgui-next/paperclip/service.log" };
const dashboard = { agents: { active: 4, running: 2, paused: 1, error: 0 }, tasks: { open: 5, inProgress: 1, blocked: 1, done: 1 }, costs: { monthSpendCents: 4800, monthBudgetCents: 35000, monthUtilizationPercent: 14 }, pendingApprovals: 1 };
const runs = agents.map((a, index) => ({ id: `run-${index}`, agentId: a.id, status: index < 2 ? "running" : "succeeded", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null, error: null, errorCode: null }));
const comments = [{ id: "comment-one", body: "Подключение готово. Проверяю переключение проектов и обработку ошибок.\n\nСледующий шаг — проверить восстановление после перезапуска.", authorAgentId: "engineer", authorUserId: null, createdAt: new Date().toISOString() }];
const goals = [
  { id: "goal-company", title: "Надёжная автономная команда", description: "Проверяемые результаты без постоянного ручного сопровождения.", level: "company", status: "active", parentId: null, ownerAgentId: "lead" },
  { id: "goal-team", title: "Подготовить следующую версию CC GUI", description: "Разработка, проверка и приёмка изменений в одном рабочем пространстве.", level: "team", status: "active", parentId: "goal-company", ownerAgentId: "engineer" },
];
const approvals = [{ id: "approval-one", type: "request_board_approval", status: "pending", requestedByAgentId: "lead", payload: { title: "Согласовать план следующей итерации", description: "Добавить управление командой и проверить восстановление после перезапуска.", acceptance: ["Тесты проходят", "Данные существующей команды сохранены"] }, decisionNote: null, createdAt: new Date().toISOString() }];
const routines = [{ id: "routine-one", title: "Утренний обзор проекта", description: "Проверь изменения за последние сутки, открытые задачи и блокировки. Подготовь короткий отчёт со следующими шагами.", status: "active", assigneeAgentId: "lead", projectId: "desktop", goalId: "goal-team", priority: "medium", latestRevisionId: "revision-one", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", variables: [], triggers: [{ id: "schedule-one", kind: "schedule", enabled: true, cronExpression: "0 9 * * *", timezone: "Europe/Moscow", nextRunAt: new Date(Date.now() + 3600000).toISOString() }] }];
const budgets = { policies: [{ policyId: "budget-one", scopeType: "company", scopeId: "company", scopeName: "Framix · preview", metric: "billed_cents", windowKind: "calendar_month_utc", amount: 35000, observedAmount: 4800, utilizationPercent: 14, warnPercent: 80, hardStopEnabled: true, unpricedUsagePolicy: "block", unpricedEventCount: 0, isActive: true, status: "ok", paused: false }], activeIncidents: [] };
paperclipApi.avatar = async (palette) => {
  const previews = (window as unknown as { __PAPERCLIP_AVATAR_PREVIEW__?: Record<string, string> }).__PAPERCLIP_AVATAR_PREVIEW__;
  const image = palette ? previews?.[palette] : null;
  if (!image) throw new Error("Avatar fixture uses the role fallback unless local preview images are supplied");
  return image;
};
paperclipApi.codexLimits = async () => ({ providers: [{ id: "codex", status: "ok", plan: "Pro", windows: [{ id: "session", kind: "session", label: null, usedPercent: 35, windowSeconds: 18000, resetsAt: Date.now() + 7200000 }], extra: null, fetchedAt: Date.now(), retryAt: null, error: null, host: "chatgpt.com" }] });
paperclipApi.service = async (action) => action === "stop" ? { supported: true, installed: false, running: false } : service;
paperclipApi.connect = async () => ({ version: "preview" });
paperclipApi.config = async () => ({ config, configured: true, service });
const completedDemoRuns = new Set<string>();
const demoStartedAt = new Date(Date.now() - 62000).toISOString();
const demoRun = (runId: string) => ({ id: runId, agentId: "engineer", agentName: "Engineer", status: completedDemoRuns.has(runId) ? "succeeded" : "running", startedAt: demoStartedAt, createdAt: demoStartedAt, finishedAt: completedDemoRuns.has(runId) ? new Date().toISOString() : null, error: null, errorCode: null });
const demoEvent = (seq: number, itemId: string, kind: string, text: string | null, name: string | null = null, status = "completed") => ({ seq, itemId, kind, text, name, status, time: new Date().toISOString(), delta: false, eventType: status === "running" ? "item.started" : "item.completed" });
paperclipApi.request = async <T,>(action: string, id?: string, body?: Record<string, unknown>): Promise<T> => {
  let result: unknown;
  switch (action) {
    case "issueLiveRuns": result = params.has("live") && !completedDemoRuns.has(`live-${id}`) ? [demoRun(`live-${id}`)] : []; break;
    case "issueExecution": result = params.has("live") ? { runId: `live-${id}`, agentId: "engineer" } : null; break;
    case "runStatus": result = demoRun(id!); break;
    case "runEvents": {
      const cursor = Number(body?.afterSeq ?? 0);
      const events = [demoEvent(1, "progress", "message", "Проверяю правила импорта и очередь: сначала готовые черновики, затем новые кандидаты. Обрабатываю до двух бизнесов."), demoEvent(2, "thought", "reasoning", "Уточняю подходящие категории и проверяю, какие записи уже обработаны."), demoEvent(3, "tool-one", "tool", null, "site_import_crawl", "failed"), demoEvent(4, "tool-two", "tool", null, "site_import_get_queue", "running")];
      if (cursor >= 4) { completedDemoRuns.add(id!); events.push(demoEvent(5, "tool-two", "tool", null, "site_import_get_queue"), demoEvent(6, "result", "message", "Очередь проверена. Подготовил черновик и итоговый отчёт по задаче.")); }
      result = { events: events.filter((e) => e.seq > cursor), nextSeq: cursor >= 4 ? 6 : 4, hasMore: false }; break;
    }
    case "quotaWindows": result = [{ provider: "openai", accountKey: "demo-codex", accountLabel: "Codex · Команда", ok: true, capturedAt: new Date().toISOString(), windows: [{ label: "5h", usedPercent: 35, resetsAt: new Date(Date.now() + 7200000).toISOString(), valueLabel: null }, { label: "7d", usedPercent: 68, resetsAt: new Date(Date.now() + 172800000).toISOString(), valueLabel: null }] }]; break;
    case "costByAgent": result = agents.map((a, i) => ({ agentId: a.id, agentName: a.name, costCents: a.spentMonthlyCents, inputTokens: 120000 * (i + 1), cachedInputTokens: 430000 * (i + 1), outputTokens: 16000 * (i + 1), eventCount: 12, estimatedEventCount: i === 1 ? 1 : 0, unpricedEventCount: 0, apiRunCount: 0, subscriptionRunCount: 12 })); break;
    case "usageRuns": result = runs.filter((r) => !body?.agentId || r.agentId === body.agentId).map((r) => ({ ...r, costUsd: null, inputTokens: 12500, cachedInputTokens: 45000, outputTokens: 2300 })); break;
    case "goals": result = goals; break;
    case "approvals": result = approvals; break;
    case "routines": result = routines; break;
    case "routine": result = routines.find((r) => r.id === id); break;
    case "budgets": result = budgets; break;
    case "agentConfiguration": result = { ...agents.find((a) => a.id === id), capabilities: "Разработка, проверка и документирование результатов.", configurationRevision: "a".repeat(64), adapterConfig: { model: "", cwd: "/Users/example/Projects/ccgui" }, runtimeConfig: { heartbeat: { enabled: false, intervalSec: 300 } } }; break;
    case "agentInstructions": result = { mode: "managed", entryFile: "AGENTS.md", resolvedEntryPath: "/managed/AGENTS.md" }; break;
    case "agentInstructionFile": result = { path: "AGENTS.md", content: "# Рабочие инструкции\n\nПроверяй результаты тестами и сообщай о блокировках.", editable: true, contentHash: "b".repeat(64), revision: { id: "revision-one" } }; break;
    case "saveAgentInstructions": result = { ...body, editable: true, contentHash: "c".repeat(64), revision: { id: crypto.randomUUID() } }; break;
    case "createAgent": result = { ...agents[0], ...body, id: crypto.randomUUID(), status: "idle" }; agents.push(result as Agent); break;
    case "updateAgent": { const a = agents.find((a) => a.id === id); if (a) Object.assign(a, body); result = a; break; }
    case "createProject": result = { ...body, id: crypto.randomUUID() }; projects.push(result as typeof projects[number]); break;
    case "updateProject": { const p = projects.find((p) => p.id === id); if (p) Object.assign(p, body); result = p; break; }
    case "createGoal": result = { ...body, id: crypto.randomUUID() }; goals.push(result as typeof goals[number]); break;
    case "updateGoal": { const g = goals.find((g) => g.id === id); if (g) Object.assign(g, body); result = g; break; }
    case "approve": case "reject": case "requestRevision": { const a = approvals.find((a) => a.id === id); if (a) Object.assign(a, { status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "revision_requested", decisionNote: body?.decisionNote }); result = a; break; }
    case "createRoutine": result = { ...body, id: crypto.randomUUID(), latestRevisionId: crypto.randomUUID(), triggers: [] }; routines.push(result as typeof routines[number]); break;
    case "updateRoutine": { const r = routines.find((r) => r.id === id); if (r) Object.assign(r, body, { latestRevisionId: crypto.randomUUID() }); result = r; break; }
    case "createSchedule": { const trigger = { ...body, id: crypto.randomUUID() }; const r = routines.find((r) => r.id === id); if (r) { r.triggers.push(trigger as typeof r.triggers[number]); r.latestRevisionId = crypto.randomUUID(); } result = { trigger }; break; }
    case "updateSchedule": { const trigger = routines.flatMap((r) => r.triggers).find((s) => s.id === id); if (trigger) Object.assign(trigger, body); result = trigger; break; }
    case "runRoutine": result = { status: "enqueued" }; break;
    case "saveBudget": { const policy = { ...budgets.policies[0], ...body, policyId: crypto.randomUUID() }; budgets.policies.push(policy); result = policy; break; }
    case "companies": result = [{ id: "company", name: "Framix · preview", status: "active" }]; break;
    case "agents": result = agents; break;
    case "projects": result = projects; break;
    case "issues": result = issues; break;
    case "runs": result = runs; break;
    case "dashboard": result = dashboard; break;
    case "issue": result = issues.find((i) => i.id === id); break;
    case "attachments": result = taskFiles.get(id!) ?? []; break;
    case "uploadAttachment": {
      const bytes = Uint8Array.from(atob(String(body?.base64)), (c) => c.charCodeAt(0));
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      result = { id: crypto.randomUUID(), originalFilename: body?.name, byteSize: bytes.length, sha256 };
      taskFiles.set(id!, [...(taskFiles.get(id!) ?? []), result]); break;
    }
    case "comments": result = comments; break;
    case "updateIssue": issues = issues.map((i) => i.id === id ? { ...i, ...body } as Issue : i); result = issues.find((i) => i.id === id); break;
    case "createIssue": result = { ...issues[0], ...body, id: `task-${issues.length + 1}`, identifier: `TEAM-${issues.length + 1}` }; issues = [result as Issue, ...issues]; break;
    case "comment": result = { ...comments[0], ...body, id: crypto.randomUUID(), authorAgentId: null }; comments.unshift(result as typeof comments[number]); break;
    default: result = {};
  }
  return result as T;
};
usePaperclipStore.setState({ initialized: true, connected: true, config, service, companyId: "company", companies: [{ id: "company", name: "Framix · preview", status: "active" }], agents, projects, issues, runs, dashboard, statusUpdatedAt: Date.now(), updatedAt: Date.now(), view: (["tasks", "agents", "projects", "goals", "approvals", "routines", "budgets", "activity", "settings"].includes(params.get("view") ?? "") ? params.get("view")! : "tasks") as import("../../src/features/paperclip/store").TeamView, selectedIssueId: params.has("detail") ? "task-1" : null });
if (params.has("sidebar")) {
  const tab = { engine: "codex" as const, sessionId: "preview-run", workspacePath: "/preview" };
  useChatStore.setState({ openTabs: [tab], streamingByKey: { [sessionKey(tab.engine, tab.sessionId, tab.workspacePath)]: true } });
}
const homePath = "/Users/example/Projects/ccgui";
if (params.has("home")) {
  useProjectHomeStore.setState({ paths: [homePath], activePath: homePath, bindings: { [homePath]: { port: 3100, companyId: "company", projectId: "desktop" } } });
  useChatStore.setState({ workspaces: [{ id: "home", path: homePath, name: "ccgui", groupId: null, lastOpenedAt: null, sortOrder: null }],
    sessions: [{ engine: "codex", sessionId: "project-session", workspacePath: homePath, title: "Доработать карточку объявления", customTitle: null, preview: "Проверить форму и поправить отображение цены на мобильных экранах.", createdAt: Date.now(), updatedAt: Date.now(), messageCount: 12, pinned: false, filePath: "", fileSize: 0, fileMtimeMs: Date.now() } as SessionMeta],
    streamingByKey: { [sessionKey("codex", "project-session", homePath)]: true }, openTabs: [] });
  ipc.listDir = async (path) => path.endsWith("/src") ? [{ name: "App.tsx", isDir: false, size: 300, mtimeMs: Date.now() }] : [{ name: "src", isDir: true, size: 0, mtimeMs: Date.now() }, { name: "package.json", isDir: false, size: 300, mtimeMs: Date.now() }, { name: "README.md", isDir: false, size: 300, mtimeMs: Date.now() }];
  ipc.gitStatus = async () => ({ branch: "main", staged: [], unstaged: [{ path: "src/App.tsx", status: "M", additions: 18, deletions: 4 }], untracked: [] });
  ipc.gitBranches = async () => [];
}
createRoot(document.getElementById("root")!).render(<div style={{ height: "100dvh", display: "flex" }}>{params.has("sidebar") && <aside style={{ width: 280, flexShrink: 0, padding: "24px 12px", borderRight: "1px solid var(--color-separator-border)" }}>
  <PaperclipNavEntry onOpen={() => usePaperclipStore.getState().setView("tasks")} />
  <AgentBoardNavEntry onOpen={() => {}} />
</aside>}{params.has("home") ? <ProjectHome path={homePath} visible /> : <PaperclipTeam />}</div>);
