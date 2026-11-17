import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Activity, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, File, Folder, FolderOpen, GitBranch, Link2, ListTodo, MessageSquare, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ipc, type DirEntry, type SessionMeta } from "@/lib/ipc";
import { openExternal } from "@/lib/platform";
import { errorText } from "@/lib/errors";
import { sessionKey, useChatStore } from "@/features/chat/store";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { useFilesStore } from "@/features/files/store";
import { ChangesPanel } from "@/features/git/ChangesPanel";
import { waitingTabs } from "@/features/agent-board/derive";
import { PaperclipSelect } from "@/features/paperclip/PaperclipSelect";
import { IssueDetail, NewTask, TaskList } from "@/features/paperclip/PaperclipTeam";
import { IssueActivity } from "@/features/paperclip/IssueActivity";
import { TaskSplit } from "@/features/paperclip/TaskSplit";
import { usePaperclipStore } from "@/features/paperclip/store";
import { paperclipApi, type Project, type Issue, type Agent } from "@/features/paperclip/api";
import { openPaperclipTeam } from "@/features/paperclip/actions";
import { useSidebarStatus } from "@/features/paperclip/use-sidebar-status";
import { normalizeProjectPath, useProjectHomeStore, type ProjectSection } from "./store";
import { resolveProjectBinding } from "./model";
import { startProjectSession } from "./actions";
import "./project-home.css";

const sections = [
  { id: "tasks", icon: ListTodo }, { id: "sessions", icon: MessageSquare },
  { id: "files", icon: GitBranch }, { id: "activity", icon: Activity },
] as const;


export function ProjectHome({ path, visible }: { path: string; visible: boolean }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  useSidebarStatus(visible);
  const team = usePaperclipStore();
  const saved = useProjectHomeStore((s) => s.bindings[normalizeProjectPath(path)]);
  const chat = useChatStore(useShallow((s) => ({ sessions: s.sessions, workspaces: s.workspaces, aliases: s.workspaceAliases, tabs: s.openTabs, streaming: s.streamingByKey, retrying: s.retryingByKey, unseen: s.unseen })));
  const waiting = useChatStore(useShallow((s) => waitingTabs(s.openTabs, s.bySession).map((tab) => sessionKey(tab.engine, tab.sessionId, tab.workspacePath))));
  const errorKeys = useChatStore(useShallow((s) => Object.entries(s.bySession).filter(([, value]) => !!value.error).map(([key]) => key)));
  const [section, setSection] = useState<ProjectSection>("tasks");
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [activityIssue, setActivityIssue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useActionFeedback({ spin: true });
  const [starting, setStarting] = useState(false);
  const name = chat.aliases[chat.workspaces.find((w) => w.path === path)?.id ?? ""] || chat.workspaces.find((w) => w.path === path)?.name || path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  const project = team.connected ? resolveProjectBinding(path, saved, team.config?.port, team.companyId, team.projects) : undefined;
  const bindingKey = project ? `${team.config?.port}:${team.companyId}:${project.id}` : "unlinked";
  const issues = project ? team.issues.filter((issue) => issue.projectId === project.id) : [];
  const sessions = useMemo(() => {
    type Entry = Pick<SessionMeta, "engine" | "sessionId" | "workspacePath" | "title" | "customTitle" | "preview" | "updatedAt">;
    const entries: Entry[] = chat.sessions.filter((s) => normalizeProjectPath(s.workspacePath) === normalizeProjectPath(path));
    const known = new Set(entries.map((s) => sessionKey(s.engine, s.sessionId, s.workspacePath)));
    for (const tab of chat.tabs) {
      if (tab.sessionId && normalizeProjectPath(tab.workspacePath) === normalizeProjectPath(path) && !known.has(sessionKey(tab.engine, tab.sessionId, tab.workspacePath))) {
        entries.push({ engine: tab.engine, sessionId: tab.sessionId, workspacePath: tab.workspacePath, title: t("chat.newSession"), customTitle: null, preview: "", updatedAt: null });
      }
    }
    return entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [chat.sessions, chat.tabs, path, t]);
  const drafts = chat.tabs.filter((tab) => tab.sessionId === null && normalizeProjectPath(tab.workspacePath) === normalizeProjectPath(path));
  const visibleSessions = sessions.filter((s) => `${s.customTitle ?? s.title} ${s.engine}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const sessionStatus = (key: string) => waiting.includes(key) ? "waiting" : chat.retrying[key] || chat.streaming[key] ? "running" : errorKeys.includes(key) ? "error" : chat.unseen[key] ? "done" : "idle";
  useEffect(() => { setSelected(null); setActivityIssue(null); setCreating(false); }, [bindingKey]);
  useEffect(() => {
    if (!visible || !team.connected) return;
    let cancelled = false;
    const tick = () => {
      const state = usePaperclipStore.getState();
      if (cancelled || document.visibilityState === "hidden" || state.busy) return;
      void state.refresh().catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [visible, team.connected, team.companyId]);
  const start = async () => {
    if (starting) return;
    setStarting(true); setError(null);
    try { await startProjectSession(path); } catch (e) { setError(errorText(e)); } finally { setStarting(false); }
  };
  const openSession = (engine: string, sessionId: string | null, workspacePath: string) => {
    dismissCenterSurfaces();
    useChatStore.getState().focusTab(engine, sessionId, workspacePath);
  };
  const external = (url: string) => {
    const prefix = team.companies.find((c) => c.id === team.companyId)?.issuePrefix;
    openExternal(`http://127.0.0.1:${team.config?.port ?? 3100}${prefix ? `/${encodeURIComponent(prefix)}` : ""}${url}`);
  };
  const task = issues.find((issue) => issue.id === selected);
  const activeCount = sessions.filter((s) => sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath)) === "running").length;
  const attention = issues.filter((i) => ["blocked", "in_review"].includes(i.status)).length;
  const linked = Boolean(project);
  return <div className="pc-root ph-root">
    <header className="ph-header">
      <div className="ph-heading"><div className="ph-mark"><FolderOpen size={23} aria-hidden /></div><div><span className="ph-eyebrow">{t("projectHome.workspace")}</span><h1>{name}</h1><p title={path}>{path}</p></div></div>
      <div className="ph-header-actions"><button className={`ph-link ${linked ? "ph-linked" : ""}`} onClick={() => setLinking(!linking)} aria-expanded={linking} aria-controls={`${id}-link`}><Link2 size={14} aria-hidden />{project?.name ?? t("projectHome.linkTeam")}<ChevronRight size={13} aria-hidden /></button><Button leadingIcon={Plus} size="small" disabled={starting} onClick={() => void start()}>{t("projectHome.newSession")}</Button></div>
    </header>
    {linking && <ProjectLink key={`${team.config?.port}:${team.companyId}`} id={`${id}-link`} path={path} name={name} selected={project?.id ?? ""} onClose={() => setLinking(false)} />}
    <nav className="ph-tabs" aria-label={t("projectHome.sections")}>
      {sections.map(({ id: key, icon: Icon }) => <button key={key} type="button" aria-label={t(`projectHome.${key}`)} aria-current={section === key ? "page" : undefined} onClick={() => { setSection(key); setQuery(""); }}><Icon size={16} aria-hidden />{t(`projectHome.${key}`)}{(key === "tasks" && linked || key === "sessions") && <span>{key === "tasks" ? issues.filter((i) => !["done", "cancelled"].includes(i.status)).length : sessions.length + drafts.length}</span>}{key === "activity" && (activeCount > 0 || attention > 0) && <i aria-label={t("projectHome.attention")} />}</button>)}
    </nav>
    {(error || (linked && team.error)) && <div className="pc-alert" role="alert">{error ?? team.error}</div>}
    <div className="ph-section-heading"><div><h2>{t(`projectHome.${section}`)}</h2><p>{t(`projectHome.${section}Hint`)}</p></div>
      <div className="ph-tools">{(section === "tasks" || section === "sessions") && <label className="ph-search"><Search size={15} aria-hidden /><input aria-label={t("projectHome.search")} placeholder={t("projectHome.search")} value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
        {section !== "files" && <Button size="small" variant="ghost" iconOnly aria-label={t("projectHome.refresh")} disabled={refresh.feedback === "running"} onClick={() => { setError(null); void refresh.start(async () => { if (linked) await usePaperclipStore.getState().refresh(); await useChatStore.getState().refreshSessions(); }).catch((e) => setError(errorText(e))); }}><ActionFeedbackIcon icon={RefreshCw} feedback={refresh.feedback} spin /></Button>}
        {section === "tasks" && linked && <Button leadingIcon={Plus} size="small" disabled={!!team.busy} onClick={() => setCreating(!creating)}>{t("paperclip.newTask")}</Button>}
      </div>
    </div>
    <div className="ph-body">
      <div className="ph-panel" hidden={section !== "tasks"}>{project ? <TaskSplit listFocused={creating} visible={visible && section === "tasks"} detail={task ? <IssueDetail key={`${bindingKey}:${task.id}`} id={task.id} visible={visible && section === "tasks"} onOpen={external} onClose={() => setSelected(null)} /> : null}>
        <main className="pc-main ph-task-main">{creating && <NewTask key={bindingKey} scope={project.id} onCreated={setSelected} onClose={() => setCreating(false)} />}<TaskList visible={visible && section === "tasks"} scope={project.id} query={query} selectedId={selected} onSelect={setSelected} /></main>
      </TaskSplit> : <ProjectEmpty icon={ListTodo} title={t("projectHome.noTeamTitle")} text={t("projectHome.noTeamHint")}><Button variant="secondary" size="small" leadingIcon={Link2} onClick={() => setLinking(true)}>{t("projectHome.linkTeam")}</Button><Button variant="ghost" size="small" onClick={() => setSection("sessions")}>{t("projectHome.goSessions")}</Button></ProjectEmpty>}</div>
      {section === "sessions" && <div className="ph-scroll">
        <h3 className="ph-session-group">{t("projectHome.personalSessions")}</h3>
        {drafts.filter(() => !query).map((tab) => <button key={tab.engine} className="ph-session" onClick={() => openSession(tab.engine, null, tab.workspacePath)}><EngineIcon engine={tab.engine} className="size-5" /><div><strong>{t("projectHome.draft")}</strong><p>{tab.engine} · {t("projectHome.draftHint")}</p></div><ChevronRight size={16} /></button>)}
        {visibleSessions.map((s) => {
          const status = sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath));
          return <button className="ph-session" key={`${s.engine}:${s.sessionId}`} onClick={() => openSession(s.engine, s.sessionId, s.workspacePath)}><EngineIcon engine={s.engine} className="size-5" /><div><strong>{s.customTitle || s.title || t("chat.newSession")}</strong><p>{s.preview || s.engine}</p><small>{s.engine}{s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" })}` : ""}</small></div>{status !== "idle" && <span className={`ph-state ph-${status}`}>{t(`agentBoard.status.${status}`, { defaultValue: t(`projectHome.${status}`) })}</span>}<ChevronRight size={16} aria-hidden /></button>;
        })}
        {!visibleSessions.length && (!drafts.length || !!query) && <ProjectEmpty icon={MessageSquare} title={t("projectHome.noSessions")} text={t(query ? "projectHome.noMatches" : "projectHome.noSessionsHint")}><Button size="small" leadingIcon={Plus} onClick={() => void start()} disabled={starting}>{t("projectHome.newSession")}</Button></ProjectEmpty>}
        {project && <TeamSessions issues={issues.filter((issue) => `${issue.identifier} ${issue.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))} agents={team.agents} visible={visible} onOpenTask={(id) => { setSelected(id); setSection("tasks"); }} />}
      </div>}
      {section === "files" && <ProjectFiles key={path} path={path} visible={visible} />}
      {section === "activity" && <div className="ph-scroll ph-activity">
        <section><div className="ph-group-heading"><Users size={16} /><h3>{t("projectHome.teamActivity")}</h3></div>
          {!linked ? <p className="ph-muted">{t("projectHome.noTeamHint")}</p> : <>{team.statusError && <div className="pc-alert" role="status">{t("projectHome.stale")}</div>}{issues.filter((i) => ["in_progress", "blocked", "in_review"].includes(i.status)).map((issue) => <div className="ph-activity-item" key={issue.id}><button className="ph-activity-row" aria-expanded={activityIssue === issue.id} onClick={() => setActivityIssue(activityIssue === issue.id ? null : issue.id)}><CircleAlert size={16} className={issue.status === "blocked" ? "ph-error" : "ph-muted"} /><span><small>{issue.identifier}</small><strong>{issue.title}</strong></span><span className={`pc-status pc-status-${issue.status}`}>{t(`paperclip.status.${issue.status}`)}</span><ChevronRight size={15} /></button>{activityIssue === issue.id && <div className="ph-inline-activity"><IssueActivity id={issue.id} visible={visible} /><button className="pc-text-link" onClick={() => { setSelected(issue.id); setSection("tasks"); }}>{t("projectHome.openTask")}<ArrowUpRight size={14} /></button></div>}</div>)}{!issues.some((i) => ["in_progress", "blocked", "in_review"].includes(i.status)) && <p className="ph-muted">{t("projectHome.noTeamActivity")}</p>}</>}
        </section>
        <section><div className="ph-group-heading"><MessageSquare size={16} /><h3>{t("projectHome.sessionActivity")}</h3></div>
          {sessions.filter((s) => sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath)) !== "idle").map((s) => <button className="ph-activity-row" key={`${s.engine}:${s.sessionId}`} onClick={() => openSession(s.engine, s.sessionId, s.workspacePath)}><Activity size={16} /><span><strong>{s.customTitle || s.title}</strong></span><span className={`ph-state ph-${sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath))}`}>{t(`projectHome.${sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath))}`)}</span><ChevronRight size={15} /></button>)}
          {!sessions.some((s) => sessionStatus(sessionKey(s.engine, s.sessionId, s.workspacePath)) !== "idle") && <p className="ph-muted">{t("projectHome.noSessionActivity")}</p>}
        </section>
      </div>}
    </div>
    <footer className="ph-footer"><span><Folder size={13} aria-hidden />{name}</span><span>{linked ? <><CheckCircle2 size={13} aria-hidden />{t("projectHome.connected")}</> : t("projectHome.localOnly")}</span></footer>
  </div>;
}

function TeamSessions({ issues, agents, visible, onOpenTask }: { issues: Issue[]; agents: Agent[]; visible: boolean; onOpenTask: (id: string) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  return <section className="ph-team-sessions"><h3 className="ph-session-group">{t("projectHome.teamSessions")}</h3><p className="ph-muted">{t("projectHome.teamSessionsHint")}</p>
    {issues.map((issue) => <div key={issue.id}><button className="ph-session" aria-expanded={expanded === issue.id} onClick={() => setExpanded(expanded === issue.id ? null : issue.id)}><Users size={18} aria-hidden /><div><strong>{issue.title}</strong><p>Paperclip · {issue.identifier}{issue.assigneeAgentId ? ` · ${agents.find((a) => a.id === issue.assigneeAgentId)?.name ?? issue.assigneeAgentId}` : ""}</p></div><ChevronRight size={15} aria-hidden /></button>{expanded === issue.id && <div className="ph-inline-activity"><IssueActivity id={issue.id} visible={visible} /><button className="pc-text-link" onClick={() => onOpenTask(issue.id)}>{t("projectHome.openTask")}<ArrowUpRight size={14} /></button></div>}</div>)}
    {!issues.length && <p className="ph-muted">{t("projectHome.noMatches")}</p>}
  </section>;
}

function ProjectLink({ id, path, name, selected, onClose }: { id: string; path: string; name: string; selected: string; onClose: () => void }) {
  const { t } = useTranslation();
  const team = usePaperclipStore();
  const [choice, setChoice] = useState(selected);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const bind = (projectId: string) => {
    useProjectHomeStore.getState().bind(path, projectId && team.config ? { port: team.config.port, companyId: team.companyId, projectId } : null);
    onClose();
  };
  return <section className="ph-link-editor" id={id} aria-label={t("projectHome.linkTeam")}><div><strong>{t("projectHome.linkTitle")}</strong><p>{t("projectHome.linkHint")}</p></div><button className="ph-close" onClick={onClose} aria-label={t("common.close")}><X size={16} /></button>
    {error && <p className="pc-alert" role="alert">{error}</p>}
    {team.connected && team.companyId ? <><label>{t("projectHome.teamProject")}<PaperclipSelect value={choice} onValueChange={setChoice} aria-label={t("projectHome.teamProject")}><option value="">{t("projectHome.unlinked")}</option>{team.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</PaperclipSelect></label><div className="ph-link-actions"><Button size="small" variant="secondary" onClick={() => bind(choice)}>{t("common.save")}</Button><Button size="small" variant="ghost" disabled={!!team.busy} onClick={() => {
      setError(null);
      void team.mutate("project-home:create", () => paperclipApi.request<Project>("createProject", team.companyId, { name, status: "planned", idempotencyKey: requestId.current, workspace: { cwd: path, sourceType: "local_path", isPrimary: true } })).then((project) => { if (mounted.current) bind(project.id); }).catch((e) => { if (mounted.current) setError(errorText(e)); });
    }}>{t("projectHome.createTeamProject")}</Button></div></> : <Button size="small" variant="secondary" onClick={() => { openPaperclipTeam(); usePaperclipStore.getState().setView("settings"); }}>{t("projectHome.connectTeam")}</Button>}
  </section>;
}

function ProjectEmpty({ icon: Icon, title, text, children }: { icon: typeof Folder; title: string; text: string; children?: React.ReactNode }) {
  return <div className="ph-empty"><Icon size={28} strokeWidth={1.4} aria-hidden /><h3>{title}</h3><p>{text}</p>{children && <div>{children}</div>}</div>;
}

function ProjectFiles({ path, visible }: { path: string; visible: boolean }) {
  const { t } = useTranslation();
  const [relative, setRelative] = useState<string[]>([]);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useActionFeedback({ spin: true });
  const directory = relative.length ? [path.replace(/[\\/]$/, ""), ...relative].join("/") : path;
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(null); setEntries([]);
    try {
      const next = await ipc.listDir(directory);
      if (current === generation.current) setEntries(next.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)));
    } catch (e) {
      if (current === generation.current) setError(errorText(e));
      throw e;
    } finally { if (current === generation.current) setLoading(false); }
  }, [directory]);
  useEffect(() => {
    if (!visible) return;
    void load().catch(() => {});
    return () => { ++generation.current; };
  }, [load, visible]);
  return <div className="ph-files"><section className="ph-file-browser"><div className="ph-files-heading"><h3>{t("projectHome.filesLabel")}</h3><Button variant="ghost" size="small" iconOnly disabled={loading} aria-label={t("projectHome.refreshFiles")} onClick={() => { void refresh.start(load).catch(() => {}); }}><ActionFeedbackIcon icon={RefreshCw} feedback={refresh.feedback} spin /></Button></div><nav className="ph-breadcrumbs" aria-label={t("projectHome.directory")}><button onClick={() => setRelative([])}><Folder size={13} />{t("projectHome.root")}</button>{relative.map((part, index) => <button key={index} onClick={() => setRelative(relative.slice(0, index + 1))}><ChevronRight size={12} />{part}</button>)}</nav>
      <div className="ph-file-list">{error && <div className="pc-alert" role="alert">{error}</div>}{loading && <p className="ph-muted">{t("common.loading")}</p>}{relative.length > 0 && <button onClick={() => setRelative(relative.slice(0, -1))}><ArrowLeft size={15} />{t("projectHome.parent")}</button>}{entries.map((entry) => <button key={entry.name} onClick={() => {
        // Entries are names, never executable configuration or previews.
        if ([".", ".."].includes(entry.name) || /[\\/]/.test(entry.name)) return;
        if (entry.isDir) setRelative([...relative, entry.name]);
        else void useFilesStore.getState().openFile(`${directory}/${entry.name}`).catch((e) => setError(errorText(e)));
      }}>{entry.isDir ? <Folder size={16} /> : <File size={16} />}<span>{entry.name}</span>{entry.isDir && <ChevronRight size={13} />}</button>)}{!loading && !error && !entries.length && <p className="ph-muted">{t("projectHome.emptyDirectory")}</p>}</div>
    </section><section className="ph-git"><div className="ph-files-heading"><h3><GitBranch size={15} />{t("projectHome.gitLabel")}</h3></div><ChangesPanel workspacePath={path} repoPath={path} visible={visible} /></section></div>;
}
