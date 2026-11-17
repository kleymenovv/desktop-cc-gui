import { openProjectHome } from "@/features/project-home/actions";
import { useProjectHomeStore } from "@/features/project-home/store";
import { PaperclipSelect } from "./PaperclipSelect";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Flag, Folder, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { paperclipApi, type Goal, type Project } from "./api";
import { usePaperclipStore } from "./store";
import { changedFields, EditorFrame, ignoreFailure, ManagementEmpty, ManagementFrame, useManagementResource } from "./management";

const projectStatuses = ["backlog", "planned", "in_progress", "completed", "cancelled"];
const goalStatuses = ["planned", "active", "achieved", "cancelled"];

export function ProjectsPanel({ visible, onOpen }: { visible: boolean; onOpen: (path: string) => void }) {
  const { t } = useTranslation();
  const { projects, agents, busy, refresh, setProject, setView, config, companyId } = usePaperclipStore();
  const goals = useManagementResource<Goal[]>("goals", visible);
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  return <ManagementFrame title={t("paperclip.ext.projects")} hint={t("paperclip.ext.projectsHint")} error={goals.error} loading={goals.loading} refresh={async () => { await Promise.all([refresh(), goals.refresh()]); }} actions={<Button size="small" leadingIcon={Plus} disabled={!!busy} onClick={() => setEditor("new")}>{t("paperclip.ext.newProject")}</Button>}>
    {editor && <ProjectEditor key={editor === "new" ? "new" : editor.id} project={editor === "new" ? null : editor} goals={goals.data ?? []} onClose={() => setEditor(null)} />}
    {!projects.length && <ManagementEmpty>{t("paperclip.ext.noProjects")}</ManagementEmpty>}
    <div className="pc-project-grid">{projects.map((project) => <article className="pc-project-card" key={project.id}>
      <div className="pc-resource-top"><Folder className="size-5" aria-hidden /><span className="pc-resource-state">{t(`paperclip.ext.value.${project.status}`, { defaultValue: project.status })}</span></div>
      <h3>{project.name}</h3>{project.description && <p className="pc-resource-description">{project.description}</p>}
      <div className="pc-resource-meta">{project.leadAgentId && <span>{t("paperclip.ext.projectLead")}: {agents.find((a) => a.id === project.leadAgentId)?.name ?? "—"}</span>}{project.primaryWorkspace?.cwd && <code>{project.primaryWorkspace.cwd}</code>}{project.targetDate && <span>{t("paperclip.ext.targetDate")}: {project.targetDate.slice(0, 10)}</span>}</div>
      <div className="pc-resource-actions">{project.primaryWorkspace?.cwd && <Button variant="secondary" size="small" leadingIcon={Folder} onClick={() => {
        const path = project.primaryWorkspace!.cwd!;
        if (config) useProjectHomeStore.getState().bind(path, { port: config.port, companyId, projectId: project.id });
        openProjectHome(path);
      }}>{t("projectHome.open")}</Button>}<Button variant="secondary" size="small" onClick={() => { setProject(project.id); setView("tasks"); }}>{t("paperclip.tasks")}</Button><Button variant="ghost" size="small" leadingIcon={Pencil} disabled={!!busy} onClick={() => setEditor(project)}>{t("paperclip.ext.edit")}</Button><Button variant="ghost" size="small" iconOnly leadingIcon={ArrowUpRight} aria-label={t("paperclip.fullInterface")} onClick={() => onOpen(`/projects/${project.id}`)} /></div>
    </article>)}</div>
  </ManagementFrame>;
}

function ProjectEditor({ project, goals, onClose }: { project: Project | null; goals: Goal[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { companyId, agents, busy, mutate } = usePaperclipStore();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState(project?.status ?? "planned");
  const [lead, setLead] = useState(project?.leadAgentId ?? "");
  const [goal, setGoal] = useState(project?.goalIds?.[0] ?? "");
  const [date, setDate] = useState(project?.targetDate?.slice(0, 10) ?? "");
  const [cwd, setCwd] = useState("");
  const requestId = useState(() => crypto.randomUUID())[0];
  return <EditorFrame title={t(project ? "paperclip.ext.editProject" : "paperclip.ext.newProject")} onClose={onClose}><form onSubmit={(e) => {
    e.preventDefault(); if (busy || !name.trim()) return;
    // Project creation supports its initial workspace in the same request.
    // Editing preserves all existing goal links unless the selector changes.
    const body = { name: name.trim(), description: description.trim() ? description : null, status, leadAgentId: lead || null, targetDate: date || null,
      ...(!project || goal !== (project.goalIds?.[0] ?? "") ? { goalIds: [...new Set([...(goal ? [goal] : []), ...(project?.goalIds?.slice(1) ?? [])])] } : {}),
      ...(!project ? { idempotencyKey: requestId, ...(cwd.trim() ? { workspace: { cwd: cwd.trim(), sourceType: "local_path", isPrimary: true } } : {}) } : {}) };
    const payload = project ? changedFields({ ...project, targetDate: project.targetDate?.slice(0, 10) ?? null }, body) : body;
    ignoreFailure(mutate("project", () => paperclipApi.request(project ? "updateProject" : "createProject", project?.id ?? companyId, payload)).then(onClose));
  }}><fieldset disabled={!!busy}>
    <label>{t("paperclip.ext.name")}<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>{t("paperclip.description")}<textarea rows={3} maxLength={12000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <div className="pc-form-grid"><label>{t("paperclip.statusLabel")}<PaperclipSelect aria-label={t("paperclip.statusLabel")} value={status} onValueChange={(value) => setStatus(value)}>{projectStatuses.map((s) => <option key={s} value={s}>{t(`paperclip.ext.value.${s}`)}</option>)}</PaperclipSelect></label><label>{t("paperclip.ext.projectLead")}<PaperclipSelect aria-label={t("paperclip.ext.projectLead")} value={lead} onValueChange={(value) => setLead(value)}><option value="">{t("paperclip.unassigned")}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.ext.targetDate")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
    <label>{t("paperclip.ext.goal")}<PaperclipSelect aria-label={t("paperclip.ext.goal")} value={goal} onValueChange={(value) => setGoal(value)}><option value="">{t("paperclip.ext.noGoal")}</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</PaperclipSelect></label>
    {!project && <label>{t("paperclip.ext.workspace")}<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/…/Projects/…" /><small>{t("paperclip.ext.workspaceHint")}</small></label>}
    <div className="pc-form-bottom"><p>{t("paperclip.ext.saveHint")}</p><Button type="submit" size="small" disabled={!name.trim() || !!busy}>{t("common.save")}</Button></div>
  </fieldset></form></EditorFrame>;
}

export function GoalsPanel({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const { agents, busy } = usePaperclipStore();
  const resource = useManagementResource<Goal[]>("goals", visible);
  const [editor, setEditor] = useState<Goal | "new" | null>(null);
  return <ManagementFrame title={t("paperclip.ext.goals")} hint={t("paperclip.ext.goalsHint")} error={resource.error} loading={resource.loading} refresh={resource.refresh} actions={<Button size="small" leadingIcon={Plus} disabled={!!busy} onClick={() => setEditor("new")}>{t("paperclip.ext.newGoal")}</Button>}>
    {editor && <GoalEditor key={editor === "new" ? "new" : editor.id} goal={editor === "new" ? null : editor} goals={resource.data ?? []} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); ignoreFailure(resource.refresh()); }} />}
    {resource.data?.length === 0 && <ManagementEmpty>{t("paperclip.ext.noGoals")}</ManagementEmpty>}
    <div className="pc-goals">{resource.data?.map((goal) => <article key={goal.id} className="pc-goal-row"><Flag aria-hidden className="size-4" /><div><span className="pc-resource-state">{t(`paperclip.ext.level.${goal.level}`, { defaultValue: goal.level })} · {t(`paperclip.ext.value.${goal.status}`)}</span><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}<div className="pc-resource-meta">{goal.parentId && <span>{t("paperclip.ext.parentGoal")}: {resource.data?.find((g) => g.id === goal.parentId)?.title ?? "—"}</span>}{goal.ownerAgentId && <span>{agents.find((a) => a.id === goal.ownerAgentId)?.name}</span>}</div></div><Button variant="ghost" size="small" leadingIcon={Pencil} disabled={!!busy} onClick={() => setEditor(goal)}>{t("paperclip.ext.edit")}</Button></article>)}</div>
  </ManagementFrame>;
}

function GoalEditor({ goal, goals, onClose, onSaved }: { goal: Goal | null; goals: Goal[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { companyId, agents, busy, mutate } = usePaperclipStore();
  const [title, setTitle] = useState(goal?.title ?? ""); const [description, setDescription] = useState(goal?.description ?? "");
  const [level, setLevel] = useState(goal?.level ?? "team"); const [status, setStatus] = useState(goal?.status ?? "planned");
  const [parentId, setParent] = useState(goal?.parentId ?? ""); const [owner, setOwner] = useState(goal?.ownerAgentId ?? "");
  const [uncertain, setUncertain] = useState(false);
  // Exclude descendants too; the backend remains authoritative for races.
  const descendants = new Set(goal ? [goal.id] : []);
  for (let pass = 0; pass < goals.length; pass++) for (const g of goals) if (g.parentId && descendants.has(g.parentId)) descendants.add(g.id);
  return <EditorFrame title={t(goal ? "paperclip.ext.editGoal" : "paperclip.ext.newGoal")} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); if (busy || !title.trim()) return;
    const fields = { title: title.trim(), description: description.trim() ? description : null, level, status, parentId: parentId || null, ownerAgentId: owner || null };
    ignoreFailure(mutate("goal", () => paperclipApi.request(goal ? "updateGoal" : "createGoal", goal?.id ?? companyId, goal ? changedFields(goal, fields) : fields)).then(onSaved, (error: unknown) => { if (!goal) setUncertain(true); throw error; }));
  }}><fieldset disabled={!!busy}><label>{t("paperclip.ext.name")}<input required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>{t("paperclip.description")}<textarea rows={3} maxLength={12000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <div className="pc-form-grid"><label>{t("paperclip.ext.goalLevel")}<PaperclipSelect aria-label={t("paperclip.ext.goalLevel")} value={level} onValueChange={(value) => setLevel(value)}>{["company", "team", "agent", "task"].map((s) => <option key={s} value={s}>{t(`paperclip.ext.level.${s}`)}</option>)}</PaperclipSelect></label><label>{t("paperclip.statusLabel")}<PaperclipSelect aria-label={t("paperclip.statusLabel")} value={status} onValueChange={(value) => setStatus(value)}>{goalStatuses.map((s) => <option key={s} value={s}>{t(`paperclip.ext.value.${s}`)}</option>)}</PaperclipSelect></label><label>{t("paperclip.assignee")}<PaperclipSelect aria-label={t("paperclip.assignee")} value={owner} onValueChange={(value) => setOwner(value)}><option value="">{t("paperclip.unassigned")}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label></div>
    <label>{t("paperclip.ext.parentGoal")}<PaperclipSelect aria-label={t("paperclip.ext.parentGoal")} value={parentId} onValueChange={(value) => setParent(value)}><option value="">{t("paperclip.ext.noGoal")}</option>{goals.filter((g) => !descendants.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</PaperclipSelect></label>
    <div className="pc-form-bottom"><p>{t(uncertain ? "paperclip.ext.writeUncertain" : "paperclip.ext.saveHint")}</p><Button type="submit" size="small" disabled={!!busy || !title.trim()}>{t("common.save")}</Button></div>
  </fieldset></form></EditorFrame>;
}
