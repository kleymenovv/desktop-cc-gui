import { TaskAttachmentDrop, submitTaskFiles, type TaskFile, type TaskSubmission, type TaskAttachment } from "./task-attachments";
import { PaperclipSelect } from "./PaperclipSelect";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Activity, CalendarClock, Flag, Folder, Wallet, Pencil, ArrowLeft, ArrowUpRight, Bot, Check, ChevronDown, ChevronUp, ChevronRight, Circle, Coffee, ExternalLink, Loader2, Pause, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Square, Users, X } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { IS_MAC, isWeb, openExternal } from "@/lib/platform";
import { paperclipApi, type AgentCost, type Comment, type Issue, type PaperclipConfig, type Run } from "./api";
import { usePaperclipStore, type TeamView } from "./store";
import { AgentEditor } from "./AgentEditor";
import { IssueActivity } from "./IssueActivity";
import { TaskSplit } from "./TaskSplit";
import { AgentPortrait } from "./AgentPortrait";
import { ProjectsPanel, GoalsPanel } from "./PlanningPanels";
import { ApprovalsPanel, RoutinesPanel } from "./AutomationPanels";
import { BudgetsPanel } from "./BudgetsPanel";
import { AgentSpend, QuotaPanel, UsagePanel } from "./UsagePanel";
import { useManagementResource } from "./management";
import "./paperclip.css";

const statuses = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
const priorities = ["critical", "high", "medium", "low"] as const;
const settled = (status: string) => ["done", "cancelled"].includes(status);
const running = (status: string) => ["running", "queued"].includes(status);
const consume = (promise: Promise<unknown>) => { void promise.catch(() => {}); };

function Status({ value }: { value: string }) {
  const { t } = useTranslation();
  return <span className={`pc-status pc-status-${value}`}><Circle aria-hidden className="size-2" fill="currentColor" />{t(`paperclip.status.${value}`, { defaultValue: value.replaceAll("_", " ") })}</span>;
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="pc-empty"><Bot className="size-8" aria-hidden /><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

/** Task Markdown is untrusted. Links leave through the system browser and
 * images are explicit links, so opening a task does not contact remote hosts. */
function TaskMarkdown({ children }: { children: string }) {
  const open = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, `http://127.0.0.1:${usePaperclipStore.getState().config?.port ?? 3100}`);
      if (["http:", "https:"].includes(url.protocol)) openExternal(url.href);
    } catch { /* Invalid task links have no executable fallback. */ }
  };
  const { t } = useTranslation();
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children: label }) => <a href={href} onClick={(event) => { event.preventDefault(); open(href); }}>{label}</a>,
    img: ({ src, alt }) => <button className="pc-text-link" onClick={() => open(typeof src === "string" ? src : undefined)}>{alt || t("paperclip.image")}<ExternalLink className="inline size-3" aria-hidden /></button>,
  }}>{children}</ReactMarkdown>;
}

export function PaperclipTeam({ visible = true }: { visible?: boolean }) {
  const { t, i18n } = useTranslation();
  const state = usePaperclipStore();
  const overviewId = useId();
  const [overviewExpanded, setOverviewExpanded] = useState(() => {
    try { return localStorage.getItem("paperclip:overview-expanded") === "true"; } catch { return false; }
  });
  const toggleOverview = () => {
    const next = !overviewExpanded;
    setOverviewExpanded(next);
    try { localStorage.setItem("paperclip:overview-expanded", String(next)); } catch { /* Still usable without persistent storage. */ }
  };
  const [creating, setCreating] = useState(false);
  const [usageAgent, setUsageAgent] = useState("");
  useEffect(() => { setUsageAgent(""); }, [state.companyId]);
  const [agentEditor, setAgentEditor] = useState<{ companyId: string; id: string | null } | null>(null);
  const managementView = ["projects", "goals", "approvals", "routines", "budgets", "usage"].includes(state.view);
  const refresh = useActionFeedback({ spin: true });
  useEffect(() => {
    if (isWeb || !visible) return;
    consume(usePaperclipStore.getState().initialize());
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      const current = usePaperclipStore.getState();
      if (!current.busy) {
        consume(current.refresh());
        if (!current.connected || !current.companyId) {
          consume(paperclipApi.service("status").then((service) => usePaperclipStore.setState({ service })));
        }
      }
    };
    const interval = window.setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [visible]);
  const full = (path = "/dashboard") => {
    const prefix = state.companies.find((c) => c.id === state.companyId)?.issuePrefix;
    openExternal(`http://127.0.0.1:${state.config?.port ?? 3100}${prefix ? `/${encodeURIComponent(prefix)}` : ""}${path}`);
  };
  const money = (cents: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
  const tabs: { id: TeamView; icon: typeof Bot; label: string }[] = [
    { id: "tasks", icon: ShieldCheck, label: t("paperclip.tasks") },
    { id: "agents", icon: Users, label: t("paperclip.agents") },
    { id: "projects", icon: Folder, label: t("paperclip.ext.projects") },
    { id: "goals", icon: Flag, label: t("paperclip.ext.goals") },
    { id: "approvals", icon: ShieldCheck, label: t("paperclip.ext.approvals") },
    { id: "routines", icon: CalendarClock, label: t("paperclip.ext.routines") },
    { id: "budgets", icon: Wallet, label: t("paperclip.ext.budgets") },
    { id: "usage", icon: Activity, label: t("paperclip.usage.title") },
    { id: "activity", icon: Activity, label: t("paperclip.activity") },
    { id: "settings", icon: Settings2, label: t("paperclip.connection") },
  ];
  if (isWeb) return <div className="pc-root"><Empty title={t("paperclip.desktopOnly")} /></div>;
  return <div className={`pc-root ${overviewExpanded ? "" : "pc-overview-closed"}`}>
    <header className="pc-header">
      <div className="pc-heading"><div className="pc-mark"><Users aria-hidden className="size-5" /></div><div><h1>{t("paperclip.title")}</h1><p>{t("paperclip.subtitle")}</p></div></div>
      <div className="pc-header-actions">
        {state.companies.length > 0 && <PaperclipSelect aria-label={t("paperclip.organization")} value={state.companyId} disabled={!!state.busy} onValueChange={(value) => consume(state.selectCompany(value))}>
          {state.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </PaperclipSelect>}
        {state.connected && state.view !== "settings" && <Button variant="ghost" size="small" leadingIcon={Activity} trailingIcon={overviewExpanded ? ChevronUp : ChevronDown} aria-expanded={overviewExpanded} aria-controls={overviewId} aria-label={t(overviewExpanded ? "paperclip.hideOverview" : "paperclip.showOverview")} onClick={toggleOverview}>{t("paperclip.overviewToggle")}</Button>}
        <Button variant="secondary" size="small" trailingIcon={ExternalLink} onClick={() => full()}>{t("paperclip.fullInterface")}</Button>
      </div>
    </header>
    <div className="pc-nav-row"><nav aria-label={t("paperclip.title")}>
      {tabs.map(({ id, icon: Icon, label }) => <button key={id} className={state.view === id ? "pc-tab pc-tab-active" : "pc-tab"} aria-current={state.view === id ? "page" : undefined} onClick={() => state.setView(id)}><Icon className="size-4" aria-hidden />{label}{id === "agents" && state.connected && <span className="pc-count">{state.agents.length}</span>}</button>)}
    </nav><div className="pc-connection"><span className={`pc-dot ${state.connected && !state.error ? "pc-dot-online" : ""}`} /><span>{t(state.connected ? state.error ? "paperclip.stale" : "paperclip.connected" : "paperclip.disconnected")}</span></div></div>
    {state.error && <div className="pc-alert" role="alert">{state.error}</div>}
    {state.sectionErrors.length > 0 && <div className="pc-alert" role="alert">{t("paperclip.partial")} {state.sectionErrors.join(" · ")}</div>}
    {!state.initialized ? <div className="pc-empty"><Loader2 className="size-6 animate-spin" aria-hidden /><p>{t("common.loading")}</p></div> : state.view === "settings" || !state.connected ? <ConnectionSettings key={state.config?.port} /> : <>
      <div id={overviewId} className="pc-overview" hidden={!overviewExpanded}>
        <div><span>{t("paperclip.workingNow")}</span><strong>{state.dashboard?.agents.running ?? state.agents.filter((a) => a.status === "running").length}<small>/ {state.agents.length}</small></strong></div>
        <div><span>{t("paperclip.openTasks")}</span><strong>{state.dashboard?.tasks.open ?? state.issues.filter((i) => !settled(i.status)).length}</strong></div>
        <button onClick={() => state.setView("approvals")}><span>{t("paperclip.needsReview")}</span><strong>{state.dashboard?.pendingApprovals ?? "—"}<ArrowUpRight className="size-4" aria-hidden /></strong></button>
        <button onClick={() => state.setView("budgets")}><span>{t("paperclip.monthSpend")}</span><strong>{state.dashboard ? money(state.dashboard.costs.monthSpendCents) : "—"}</strong><small>{state.dashboard?.costs.monthBudgetCents ? t("paperclip.budgetOf", { budget: money(state.dashboard.costs.monthBudgetCents) }) : t("paperclip.reportedSpend")}</small></button>
      </div>
      {!managementView && <div className="pc-content-toolbar"><div className="pc-section-heading"><h2>{t(`paperclip.${state.view}`)}</h2>{state.updatedAt && <span>{t("paperclip.updated", { time: new Date(state.updatedAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) })}</span>}</div>
        <div className="pc-toolbar-actions">
          {state.view === "tasks" && <>
            <div className="pc-search"><Search className="size-3.5" aria-hidden /><input aria-label={t("paperclip.searchTasks")} placeholder={t("paperclip.searchTasks")} value={state.search} onChange={(e) => state.setSearch(e.target.value)} /></div>
            <PaperclipSelect aria-label={t("paperclip.project")} value={state.projectId} onValueChange={(value) => state.setProject(value)}><option value="">{t("paperclip.allProjects")}</option>{state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</PaperclipSelect>
          </>}
          <Button variant="ghost" size="small" iconOnly aria-label={t("paperclip.refresh")} title={t("paperclip.refresh")} disabled={state.loading || !!state.busy || refresh.feedback === "running"} onClick={() => consume(refresh.start(() => state.refresh()))}><ActionFeedbackIcon icon={RefreshCw} feedback={refresh.feedback} spin /></Button>
          {state.view === "tasks" && <Button size="small" leadingIcon={Plus} disabled={!!state.busy || !state.companyId} onClick={() => setCreating(!creating)}>{t("paperclip.newTask")}</Button>}
          {state.view === "agents" && <Button size="small" leadingIcon={Plus} disabled={!!state.busy} onClick={() => setAgentEditor({ companyId: state.companyId, id: null })}>{t("paperclip.ext.newAgent")}</Button>}
        </div>
      </div>}
      {state.companies.length === 0 ? <Empty title={t("paperclip.noOrganizations")}><button className="pc-text-link" onClick={() => full()}>{t("paperclip.fullInterface")}</button></Empty> : <TaskSplit listFocused={creating} visible={visible} detail={state.view === "tasks" && state.selectedIssueId ? <IssueDetail key={`${state.companyId}:${state.selectedIssueId}`} id={state.selectedIssueId} visible={visible} onOpen={full} /> : null}>
        <main className="pc-main">
          {(state.view === "agents" || state.view === "usage") && <QuotaPanel key={`quota:${state.config?.port}:${state.companyId}`} visible={visible} />}
          {creating && state.view === "tasks" && <NewTask key={state.companyId} onClose={() => setCreating(false)} />}
          {state.loading && !state.updatedAt ? <div className="pc-empty"><Loader2 className="size-6 animate-spin" aria-hidden /><p>{t("common.loading")}</p></div> : <>
            {state.view === "tasks" && <TaskList visible={visible} />}
            {state.view === "agents" && <>
              {agentEditor?.companyId === state.companyId && <AgentEditor key={`${state.companyId}:${agentEditor.id ?? "new"}`} id={agentEditor.id} visible={visible} onClose={() => setAgentEditor(null)} />}
              <AgentList visible={visible} onUsage={(id) => { setUsageAgent(id); state.setView("usage"); }} onOpen={full} onEdit={(id) => setAgentEditor({ companyId: state.companyId, id })} />
            </>}
            {state.view === "projects" && <ProjectsPanel key={state.companyId} visible={visible} onOpen={full} />}
            {state.view === "goals" && <GoalsPanel key={state.companyId} visible={visible} />}
            {state.view === "approvals" && <ApprovalsPanel key={state.companyId} visible={visible} onOpen={full} />}
            {state.view === "routines" && <RoutinesPanel key={state.companyId} visible={visible} onOpen={full} />}
            {state.view === "budgets" && <BudgetsPanel key={state.companyId} visible={visible} />}
            {state.view === "usage" && <UsagePanel key={`${state.config?.port}:${state.companyId}`} visible={visible} agentId={usageAgent} onAgentChange={setUsageAgent} />}
            {state.view === "activity" && <RunList visible={visible} />}
          </>}
        </main>
      </TaskSplit>}
      <footer className="pc-footer"><span><Coffee className="size-3.5" aria-hidden />{t(state.service?.running ? state.service.worker?.keepAwake ? "paperclip.serviceAwake" : "paperclip.serviceOn" : "paperclip.serviceOff")}</span><button onClick={() => state.setView("settings")}>{t("paperclip.backgroundSettings")}<ChevronRight className="size-3" aria-hidden /></button></footer>
    </>}
  </div>;
}

export function TaskList({ visible, scope, query, selectedId, onSelect }: { visible: boolean; scope?: string; query?: string; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const { t } = useTranslation();
  const state = usePaperclipStore();
  const { issues, agents, projects } = state;
  const projectId = scope ?? state.projectId;
  const search = query ?? state.search;
  const selectedIssueId = selectedId === undefined ? state.selectedIssueId : selectedId;
  const selectIssue = onSelect ?? state.selectIssue;
  const [filter, setFilter] = useState("open");
  const filtered = issues.filter((i) => (!projectId || i.projectId === projectId) && (!search || `${i.identifier} ${i.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (filter === "all" || filter === "open" ? filter === "all" || !settled(i.status) : i.status === filter));
  return <>
    <div className="pc-filters" aria-label={t("paperclip.taskFilter")}>{["open", "in_progress", "in_review", "blocked", "done", "all"].map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`paperclip.status.${f}`)}</button>)}</div>
    {filtered.length === 0 ? <Empty title={t("paperclip.noTasks")}>{t("paperclip.noTasksHint")}</Empty> : <div className="pc-task-list">
      {filtered.map((issue) => {
        const agent = agents.find((a) => a.id === issue.assigneeAgentId);
        const project = projects.find((p) => p.id === issue.projectId);
        return <button key={issue.id} className={`pc-task-row ${selectedIssueId === issue.id ? "pc-selected" : ""}`} aria-pressed={selectedIssueId === issue.id} onClick={() => selectIssue(issue.id)}>
          <span className={`pc-priority pc-priority-${issue.priority}`} title={t(`paperclip.priority.${issue.priority}`)} aria-label={t(`paperclip.priority.${issue.priority}`)}><span /><span /><span /></span>
          <div className="pc-task-copy"><span className="pc-identifier">{issue.identifier}</span><strong>{issue.title}</strong><span className="pc-task-meta">{project?.name ?? t("paperclip.noProject")}{agent && <><span aria-hidden>·</span><AgentPortrait agent={agent} compact visible={visible} />{agent.name}</>}</span></div>
          <Status value={issue.status} /><ChevronRight className="pc-row-chevron size-3.5" aria-hidden />
        </button>;
      })}
    </div>}
    {issues.length >= 200 && <p className="pc-limit">{t("paperclip.taskLimit")}</p>}
  </>;
}

function AgentList({ onOpen, onEdit, onUsage, visible }: { onUsage: (id: string) => void; onOpen: (path: string) => void; onEdit: (id: string) => void; visible: boolean }) {
  const { t } = useTranslation();
  const { agents, issues, busy, mutate } = usePaperclipStore();
  const costs = useManagementResource<AgentCost[]>("costByAgent", visible);
  if (!agents.length) return <Empty title={t("paperclip.noAgents")}>{t("paperclip.noAgentsHint")}</Empty>;
  return <>{costs.error && <p className="pc-usage-warning" role="status">{t("paperclip.usage.spendUnavailable")}</p>}<div className="pc-agent-grid">{agents.map((agent) => {
    const taskCount = issues.filter((i) => i.assigneeAgentId === agent.id && !settled(i.status)).length;
    const manager = agents.find((a) => a.id === agent.reportsTo);
    const paused = agent.status === "paused";
    const unavailable = ["terminated", "pending_approval"].includes(agent.status);
    return <article key={agent.id} className="pc-agent"><div className="pc-agent-top"><AgentPortrait agent={agent} visible={visible} /><Status value={agent.status} /></div>
      <div className="pc-agent-title-row"><button className="pc-agent-name" disabled={!!busy} onClick={() => onEdit(agent.id)}>{agent.name}<Pencil className="size-3" aria-hidden /></button><Button variant="ghost" size="small" iconOnly leadingIcon={ExternalLink} aria-label={`${t("paperclip.fullInterface")}: ${agent.name}`} onClick={() => onOpen(`/agents/${agent.id}`)} /></div><p className="pc-agent-role">{agent.title && agent.title !== agent.name ? agent.title : t(`paperclip.ext.roleName.${agent.role}`, { defaultValue: agent.role })}</p>
      <div className="pc-agent-facts"><span>{agent.adapterType.replaceAll("_", " ")}</span><span>{t("paperclip.assignedTasks", { count: taskCount })}</span>{manager && <span>{t("paperclip.reportsTo", { name: manager.name })}</span>}</div>
      <AgentSpend row={costs.error ? undefined : costs.data?.find((row) => row.agentId === agent.id)} spentCents={agent.spentMonthlyCents} onOpen={() => onUsage(agent.id)} />
      <div className="pc-agent-actions"><Button variant="secondary" size="small" leadingIcon={Play} disabled={!!busy || paused || unavailable || agent.status === "running"} onClick={() => consume(mutate(`wake:${agent.id}`, () => paperclipApi.request("wakeAgent", agent.id)))}>{t("paperclip.wake")}</Button>
        <Button variant="ghost" size="small" leadingIcon={paused ? Play : Pause} disabled={!!busy || unavailable} onClick={() => consume(mutate(`pause:${agent.id}`, () => paperclipApi.request(paused ? "resumeAgent" : "pauseAgent", agent.id)))}>{t(paused ? "paperclip.resume" : "paperclip.pause")}</Button></div>
    </article>;
  })}</div></>;
}

function RunList({ visible }: { visible: boolean }) {
  const { t, i18n } = useTranslation();
  const { runs, agents, busy, mutate } = usePaperclipStore();
  return !runs.length ? <Empty title={t("paperclip.noRuns")}>{t("paperclip.noRunsHint")}</Empty> : <div className="pc-runs">{runs.map((run: Run) => <article key={run.id} className="pc-run">
    <div className={`pc-run-icon ${running(run.status) ? "pc-run-live" : ""}`}>{agents.find((a) => a.id === run.agentId) ? <AgentPortrait agent={agents.find((a) => a.id === run.agentId)!} compact visible={visible} /> : <Activity className="size-4" aria-hidden />}</div><div className="pc-run-copy"><strong>{agents.find((a) => a.id === run.agentId)?.name ?? run.agentId}</strong><span>{new Date(run.startedAt ?? run.createdAt).toLocaleString(i18n.language)} · {run.id.slice(0, 8)}</span>{(run.error || run.errorCode) && <p>{run.error || run.errorCode}</p>}</div><Status value={run.status} />
    {running(run.status) && <Button variant="ghost" size="small" leadingIcon={Square} disabled={!!busy} onClick={() => consume(mutate(`stop:${run.id}`, () => paperclipApi.request("stopRun", run.id)))}>{t("paperclip.stop")}</Button>}
  </article>)}</div>;
}

export function NewTask({ onClose, scope, onCreated }: { onClose: () => void; scope?: string; onCreated?: (id: string) => void }) {
  const { t } = useTranslation();
  const { companyId, config, agents, projects, projectId, busy, mutate, selectIssue } = usePaperclipStore();
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(""); const [project, setProject] = useState(scope ?? projectId); const [priority, setPriority] = useState("medium");
  const [reading, setReading] = useState(false);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const submission = useRef<TaskSubmission>({ key: crypto.randomUUID() });
  const [uncertain, setUncertain] = useState(false);
  return <form className="pc-new-task" onSubmit={(event) => {
    event.preventDefault();
    if (!title.trim() || busy || reading) return;
    consume(mutate("create", () => submitTaskFiles(submission.current, companyId, config?.port ?? 3100, { title: title.trim(), description: description.trim() || null, status: "todo", priority, assigneeAgentId: assignee || null, projectId: scope ?? (project || null) }, files))
      .then((issue) => { (onCreated ?? selectIssue)(issue.id); onClose(); }, (error: unknown) => { setUncertain(true); throw error; }));
  }}>
    <div className="pc-form-title"><h3>{t("paperclip.newTask")}</h3><Button variant="ghost" size="small" iconOnly leadingIcon={X} aria-label={t("common.close")} disabled={!!busy} onClick={onClose} /></div>
    <label>{t("paperclip.taskTitle")}<input disabled={!!busy || uncertain || !!submission.current.issue} autoFocus required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("paperclip.taskTitleHint")} /></label>
    <TaskAttachmentDrop files={files} onChange={setFiles} onReading={setReading} disabled={!!busy || (uncertain && !submission.current.issue)}>
    <label>{t("paperclip.description")}<textarea disabled={!!busy || uncertain || !!submission.current.issue} rows={3} maxLength={20000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("paperclip.descriptionHint")} /></label></TaskAttachmentDrop>
    <div className="pc-form-grid"><label>{t("paperclip.assignee")}<PaperclipSelect aria-label={t("paperclip.assignee")} disabled={!!busy || uncertain || !!submission.current.issue} value={assignee} onValueChange={(value) => setAssignee(value)}><option value="">{t("paperclip.unassigned")}</option>{agents.filter((a) => !["terminated", "pending_approval"].includes(a.status)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.project")}<PaperclipSelect aria-label={t("paperclip.project")} disabled={!!busy || scope !== undefined || uncertain || !!submission.current.issue} value={project} onValueChange={(value) => setProject(value)}><option value="">{t("paperclip.noProject")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.priorityLabel")}<PaperclipSelect aria-label={t("paperclip.priorityLabel")} disabled={!!busy || uncertain || !!submission.current.issue} value={priority} onValueChange={(value) => setPriority(value)}>{priorities.map((p) => <option key={p} value={p}>{t(`paperclip.priority.${p}`)}</option>)}</PaperclipSelect></label></div>
    <div className="pc-form-bottom"><p>{t(submission.current.issue ? "paperclip.files.partial" : uncertain ? "paperclip.writeUncertain" : "paperclip.assignmentHint")}</p><Button type="submit" size="small" disabled={!!busy || reading || !title.trim()} leadingIcon={busy === "create" ? Loader2 : Plus}>{t("paperclip.createTask")}</Button></div>
  </form>;
}

export function IssueDetail({ id, visible, onOpen, onClose }: { id: string; visible: boolean; onOpen: (path: string) => void; onClose?: () => void }) {
  const { t, i18n } = useTranslation();
  const replyId = useId();
  const { agents, busy, mutate, selectIssue } = usePaperclipStore();
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [issue, setIssue] = useState<Issue | null>(null); const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [draft, setDraft] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  const revision = useRef(0);
  const load = async () => {
    const current = ++revision.current;
    const [nextIssue, nextComments] = await Promise.all([paperclipApi.request<Issue>("issue", id), paperclipApi.request<Comment[]>("comments", id)]);
    if (mounted.current && current === revision.current) { setIssue(nextIssue); setComments([...nextComments].reverse()); setError(null); }
  };
  useEffect(() => {
    if (!visible) return;
    mounted.current = true;
    consume(load().catch((e: unknown) => { if (mounted.current) setError(String(e)); }).finally(() => { if (mounted.current) setLoading(false); }));
    const interval = window.setInterval(() => { if (document.visibilityState !== "hidden" && !usePaperclipStore.getState().busy) consume(load().catch((e: unknown) => { if (mounted.current) setError(String(e)); })); }, 10_000);
    return () => { mounted.current = false; ++revision.current; window.clearInterval(interval); };
    // A keyed detail instance owns exactly one task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void paperclipApi.request<TaskAttachment[]>("attachments", id).then((rows) => { if (!cancelled) setAttachments(Array.isArray(rows) ? rows : []); }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id, visible]);
  const update = (body: Record<string, unknown>) => {
    ++revision.current;
    consume(mutate(`issue:${id}`, () => paperclipApi.request<Issue>("updateIssue", id, body)).then((saved) => {
      ++revision.current;
      if (mounted.current) setIssue(saved);
    }));
  };
  return <aside className="pc-detail" aria-label={t("paperclip.taskDetails")}><div className="pc-detail-header"><Button variant="ghost" size="small" leadingIcon={ArrowLeft} onClick={() => onClose ? onClose() : selectIssue(null)}>{issue?.identifier ?? t("paperclip.taskDetails")}</Button><Button variant="ghost" size="small" iconOnly leadingIcon={ExternalLink} aria-label={t("paperclip.openTask")} onClick={() => onOpen(`/issues/${issue?.identifier ?? id}`)} /></div>
    <div className="pc-detail-scroll">{error && <div className="pc-alert" role="alert">{error}<button className="pc-text-link" onClick={() => consume(load().catch((e: unknown) => setError(String(e))))}>{t("paperclip.retry")}</button></div>}
      {loading ? <p className="pc-muted">{t("common.loading")}</p> : issue && <>
        <h2>{issue.title}</h2><div className="pc-detail-controls"><label>{t("paperclip.statusLabel")}<PaperclipSelect aria-label={t("paperclip.statusLabel")} value={issue.status} disabled={!!busy} onValueChange={(value) => update({ status: value })}>{statuses.map((s) => <option key={s} value={s}>{t(`paperclip.status.${s}`)}</option>)}</PaperclipSelect></label><label>{t("paperclip.assignee")}<PaperclipSelect aria-label={t("paperclip.assignee")} value={issue.assigneeAgentId ?? ""} disabled={!!busy} onValueChange={(value) => update({ assigneeAgentId: value || null })}><option value="">{t("paperclip.unassigned")}</option>{agents.filter((a) => a.status !== "terminated" || a.id === issue.assigneeAgentId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label></div>
        {!!attachments.length && <section className="pc-saved-attachments"><h3>{t("paperclip.files.title")}</h3>{attachments.map((file) => <button key={file.id} className="pc-text-link" onClick={() => openExternal(`http://127.0.0.1:${usePaperclipStore.getState().config?.port ?? 3100}/api/attachments/${encodeURIComponent(file.id)}/content?download=1`)}>{file.originalFilename ?? file.id}<ExternalLink className="size-3" aria-hidden /></button>)}</section>}
        <IssueActivity id={id} visible={visible} />
        {issue.description && <details className="pc-task-description"><summary>{t("paperclip.description")}</summary><div className="pc-markdown"><TaskMarkdown>{issue.description}</TaskMarkdown></div></details>}
        <div className="pc-thread-heading"><h3>{t("paperclip.discussion")}</h3><span>{t("paperclip.latestComments")}</span></div>
        {comments.length === 0 && <p className="pc-muted">{t("paperclip.noComments")}</p>}
        {comments.map((comment) => <article className="pc-comment" key={comment.id}><div>{agents.find((a) => a.id === comment.authorAgentId) && <AgentPortrait agent={agents.find((a) => a.id === comment.authorAgentId)!} compact visible={visible} />}<strong>{agents.find((a) => a.id === comment.authorAgentId)?.name ?? (comment.authorAgentId ? t("paperclip.agent") : t("paperclip.you"))}</strong><time>{new Date(comment.createdAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" })}</time></div><div className="pc-markdown"><TaskMarkdown>{comment.body}</TaskMarkdown></div></article>)}
      </>}
    </div>
    {issue && <form className="pc-reply" onSubmit={(event) => { event.preventDefault(); if (!draft.trim() || busy) return;
      ++revision.current;
      consume(mutate(`comment:${id}`, () => paperclipApi.request<Comment>("comment", id, { body: draft.trim(), clientRequestId: requestId.current })).then((comment) => {
        ++revision.current;
        if (!mounted.current) return;
        setComments((old) => old.some((c) => c.id === comment.id) ? old : [...old, comment]); setDraft(""); requestId.current = crypto.randomUUID();
      }));
    }}><label className="sr-only" htmlFor={replyId}>{t("paperclip.reply")}</label><textarea id={replyId} rows={3} maxLength={20000} disabled={!!busy} placeholder={t("paperclip.replyHint")} value={draft} onChange={(e) => { setDraft(e.target.value); requestId.current = crypto.randomUUID(); }} /><div><span>{t("paperclip.replyNote")}</span><Button size="small" type="submit" disabled={!!busy || !draft.trim()} trailingIcon={ArrowUpRight}>{t("paperclip.send")}</Button></div></form>}
  </aside>;
}

function ConnectionSettings() {
  const { t } = useTranslation();
  const { config, service, connected, busy, connect, controlService } = usePaperclipStore();
  const [draft, setDraft] = useState<PaperclipConfig | null>(config);
  const [portText, setPortText] = useState(String(config?.port ?? 3100));
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => { if (config) { setDraft(config); setPortText(String(config.port)); } }, [config]);
  if (!draft) return <Empty title={t("paperclip.configurationUnavailable")}><button className="pc-text-link" onClick={() => { usePaperclipStore.setState({ initialized: false }); consume(usePaperclipStore.getState().initialize()); }}>{t("paperclip.retry")}</button></Empty>;
  const set = <K extends keyof PaperclipConfig>(key: K, value: PaperclipConfig[K]) => setDraft((old) => old ? { ...old, [key]: value } : old);
  const port = Number(portText); const validPort = Number.isInteger(port) && port > 0 && port <= 65535;
  const next = { ...draft, port };
  return <div className="pc-settings-scroll"><div className="pc-settings">
    <section><div className="pc-settings-heading"><div className="pc-settings-icon"><ArrowUpRight className="size-5" aria-hidden /></div><div><h2>{t("paperclip.localConnection")}</h2><p>{t("paperclip.localConnectionHint")}</p></div></div>
      <form onSubmit={(e) => { e.preventDefault(); if (validPort) consume(connect(next)); }}><label>{t("paperclip.serverPort")}<div className="pc-port-input"><span>127.0.0.1 :</span><input type="number" min={1} max={65535} required value={portText} onChange={(e) => setPortText(e.target.value)} /></div></label><div className="pc-settings-action"><p>{t("paperclip.localOnly")}</p><Button size="small" type="submit" disabled={!!busy || !validPort} leadingIcon={busy === "connect" ? Loader2 : connected ? Check : Play}>{t(connected ? "paperclip.reconnect" : "paperclip.connect")}</Button></div></form>
    </section>
    <section><div className="pc-settings-heading"><div className="pc-settings-icon"><Coffee className="size-5" aria-hidden /></div><div><h2>{t("paperclip.backgroundTitle")}</h2><p>{t("paperclip.backgroundHint")}</p></div></div>
      <div className="pc-service-state"><Status value={service?.running ? "running" : "idle"} /><span>{t(service?.running ? service.worker?.ownership === "external" ? "paperclip.externalInstance" : service.worker?.online ? "paperclip.managedInstance" : "paperclip.serviceStarting" : "paperclip.notInstalled")}</span></div>
      {service?.worker?.error && <p className="pc-alert" role="alert">{service.worker.error}</p>}
      <label>{t("paperclip.sourceDirectory")}<input value={draft.sourceDir} onChange={(e) => set("sourceDir", e.target.value)} spellCheck={false} /></label>
      <label>{t("paperclip.dataDirectory")}<input value={draft.dataDir} onChange={(e) => set("dataDir", e.target.value)} spellCheck={false} /><small>{t("paperclip.dataHint")}</small></label>
      <button className="pc-text-link pc-advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{t("paperclip.runtimePaths")}<ChevronRight className={`size-3 ${advanced ? "rotate-90" : ""}`} aria-hidden /></button>
      {advanced && <div className="pc-runtime-paths"><label>{t("paperclip.nodePath")}<input value={draft.nodePath} onChange={(e) => set("nodePath", e.target.value)} spellCheck={false} /></label><label>{t("paperclip.pnpmPath")}<input value={draft.pnpmPath} onChange={(e) => set("pnpmPath", e.target.value)} spellCheck={false} /></label></div>}
      <label className="pc-checkbox"><input type="checkbox" checked={draft.keepAwake} onChange={(e) => set("keepAwake", e.target.checked)} /><span><strong>{t("paperclip.keepAwake")}</strong><small>{t("paperclip.keepAwakeHint")}</small></span></label>
      <div className="pc-lid-note"><ShieldCheck className="size-4" aria-hidden /><p>{t("paperclip.lidNote")}</p></div>
      <div className="pc-settings-action"><p>{t("paperclip.serviceConsent")}</p><div>{service?.installed && <Button variant="secondary" size="small" disabled={!!busy} onClick={() => consume(controlService("stop"))}>{t("paperclip.disableService")}</Button>}<Button size="small" leadingIcon={busy === "service" ? Loader2 : Play} disabled={!!busy || !IS_MAC || !validPort || !draft.sourceDir || !draft.dataDir || !draft.nodePath || !draft.pnpmPath} onClick={() => consume(controlService("start", next))}>{t(service?.installed ? "paperclip.applyService" : "paperclip.enableService")}</Button></div></div>
      {!IS_MAC && <p className="pc-muted">{t("paperclip.macOnly")}</p>}
      {service?.logPath && <p className="pc-log-path">{t("paperclip.serviceLog")}<code>{service.logPath}</code></p>}
    </section>
  </div></div>;
}
