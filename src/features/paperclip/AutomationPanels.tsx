import { PaperclipSelect } from "./PaperclipSelect";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, CalendarClock, Check, Pencil, Play, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { paperclipApi, type Approval, type Routine, type Schedule } from "./api";
import { usePaperclipStore } from "./store";
import { EditorFrame, ignoreFailure, ManagementEmpty, ManagementFrame, useManagementResource } from "./management";

function reviewPayload(value: unknown, masked: string): unknown {
  if (Array.isArray(value)) return value.map((v) => reviewPayload(v, masked));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|secret|api.?key|^env$/i.test(key) ? masked : reviewPayload(item, masked)]));
  return value;
}

export function ApprovalsPanel({ visible, onOpen }: { visible: boolean; onOpen: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const { agents, busy, mutate } = usePaperclipStore();
  const resource = useManagementResource<Approval[]>("approvals", visible);
  const [filter, setFilter] = useState("pending"); const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const approvals = (resource.data ?? []).filter((a) => filter === "all" || a.status === filter || filter === "pending" && a.status === "revision_requested");
  return <ManagementFrame title={t("paperclip.ext.approvals")} hint={t("paperclip.ext.approvalsHint")} error={resource.error} loading={resource.loading} refresh={resource.refresh}>
    <div className="pc-filters">{["pending", "approved", "rejected", "all"].map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`paperclip.ext.value.${f}`)}</button>)}</div>
    {!approvals.length && resource.data && <ManagementEmpty>{t("paperclip.ext.noApprovals")}</ManagementEmpty>}
    <div className="pc-approvals">{approvals.map((approval) => {
      const title = typeof approval.payload.title === "string" ? approval.payload.title : typeof approval.payload.name === "string" ? approval.payload.name : t(`paperclip.ext.approvalType.${approval.type}`, { defaultValue: approval.type.replaceAll("_", " ") });
      const editable = ["pending", "revision_requested"].includes(approval.status);
      return <article key={approval.id} className="pc-approval"><div className="pc-resource-top"><ShieldCheck className="size-5" aria-hidden /><span className="pc-resource-state">{t(`paperclip.ext.value.${approval.status}`, { defaultValue: approval.status })}</span></div>
        <button className="pc-resource-title" onClick={() => { setSelected(selected === approval.id ? null : approval.id); setNote(""); }}>{title}</button>
        <p className="pc-resource-meta">{agents.find((a) => a.id === approval.requestedByAgentId)?.name ?? t("paperclip.you")} · {new Date(approval.createdAt).toLocaleString(i18n.language)}</p>
        {selected === approval.id && <div className="pc-approval-detail"><p className="pc-muted">{t(`paperclip.ext.approvalType.${approval.type}`, { defaultValue: approval.type })}</p>
          <pre className="pc-request-payload">{JSON.stringify(reviewPayload(approval.payload, t("paperclip.ext.masked")), null, 2)}</pre>
          {approval.decisionNote && <p className="pc-muted">{approval.decisionNote}</p>}
          {editable && <><label>{t("paperclip.ext.decisionNote")}<textarea rows={3} maxLength={8000} disabled={!!busy} value={note} onChange={(e) => setNote(e.target.value)} /></label><p className="pc-muted">{t("paperclip.ext.approvalEffect")}</p>
            <div className="pc-resource-actions">{([ ["approve", Check], ["requestRevision", Pencil], ["reject", X] ] as const).map(([action, Icon]) => <Button key={action} size="small" variant={action === "approve" ? "primary" : "secondary"} leadingIcon={Icon} disabled={!!busy} onClick={() => ignoreFailure(mutate(`approval:${approval.id}`, () => paperclipApi.request(action, approval.id, { decisionNote: note.trim() || undefined })).then(() => { setSelected(null); setNote(""); ignoreFailure(resource.refresh()); }))}>{t(`paperclip.ext.${action}`)}</Button>)}</div></>}
        </div>}
        <button className="pc-text-link" onClick={() => onOpen(`/approvals/${approval.id}`)}>{t("paperclip.fullInterface")}<ArrowUpRight className="inline size-3" aria-hidden /></button>
      </article>;
    })}</div>
  </ManagementFrame>;
}

export function RoutinesPanel({ visible, onOpen }: { visible: boolean; onOpen: (path: string) => void }) {
  const { t, i18n } = useTranslation();
  const { agents, projects, busy, mutate } = usePaperclipStore();
  const resource = useManagementResource<Routine[]>("routines", visible);
  const [editor, setEditor] = useState<Routine | "new" | null>(null);
  const [runReceipt, setRunReceipt] = useState<{ id: string; status: string } | null>(null);
  const keys = useRef(new Map<string, string>());
  const run = (routine: Routine) => {
    const key = keys.current.get(routine.id) ?? crypto.randomUUID(); keys.current.set(routine.id, key);
    ignoreFailure(mutate(`routine-run:${routine.id}`, async () => {
      const result = await paperclipApi.request<{ status: string }>("runRoutine", routine.id, { source: "manual", idempotencyKey: key });
      if (typeof result?.status !== "string") throw new Error(t("paperclip.ext.unknownReceipt"));
      return result;
    }).then((result) => { keys.current.delete(routine.id); setRunReceipt({ id: routine.id, status: result.status }); ignoreFailure(resource.refresh()); }));
  };
  return <ManagementFrame title={t("paperclip.ext.routines")} hint={t("paperclip.ext.routinesHint")} error={resource.error} loading={resource.loading} refresh={resource.refresh} actions={<Button size="small" leadingIcon={Plus} disabled={!!busy} onClick={() => setEditor("new")}>{t("paperclip.ext.newRoutine")}</Button>}>
    {editor && <RoutineEditor key={editor === "new" ? "new" : editor.id} routine={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={(saved) => { setEditor(saved); ignoreFailure(resource.refresh()); }} />}
    {resource.data?.length === 0 && <ManagementEmpty>{t("paperclip.ext.noRoutines")}</ManagementEmpty>}
    <div className="pc-routine-list">{resource.data?.map((routine) => {
      const requiredVariables = routine.variables?.some((v) => v.required && v.defaultValue == null);
      return <article key={routine.id} className="pc-routine-card"><div className="pc-resource-top"><CalendarClock className="size-5" aria-hidden /><span className="pc-resource-state">{t(`paperclip.ext.value.${routine.status}`)}</span></div>
        <h3>{routine.title}</h3>{routine.description && <p className="pc-resource-description">{routine.description}</p>}
        <div className="pc-resource-meta"><span>{agents.find((a) => a.id === routine.assigneeAgentId)?.name ?? t("paperclip.unassigned")}</span>{routine.projectId && <span>{projects.find((p) => p.id === routine.projectId)?.name}</span>}</div>
        <div className="pc-schedule-list">{routine.triggers?.filter((s) => s.kind === "schedule").map((s) => <div key={s.id}><code>{s.cronExpression}</code><span>{s.timezone}</span><span>{t(s.enabled ? "paperclip.ext.scheduleEnabled" : "paperclip.ext.scheduleDisabled")}</span>{s.enabled && s.nextRunAt && <time>{t("paperclip.ext.nextRun", { time: new Date(s.nextRunAt).toLocaleString(i18n.language) })}</time>}</div>)}</div>
        {!routine.triggers?.some((s) => s.kind === "schedule") && <p className="pc-muted">{t("paperclip.ext.noSchedule")}</p>}
        {requiredVariables && <p className="pc-muted">{t("paperclip.ext.requiresVariables")}</p>}
        {runReceipt?.id === routine.id && <p role="status" className="pc-muted">{t("paperclip.ext.runReceipt", { status: t(`paperclip.ext.value.${runReceipt.status}`, { defaultValue: runReceipt.status }) })}</p>}
        <div className="pc-resource-actions"><Button variant="secondary" size="small" leadingIcon={Play} disabled={!!busy || !!requiredVariables || routine.status !== "active"} onClick={() => run(routine)}>{t("paperclip.ext.runOnce")}</Button><Button variant="ghost" size="small" disabled={!!busy || routine.status === "archived"} onClick={() => ignoreFailure(mutate(`routine-status:${routine.id}`, () => paperclipApi.request("updateRoutine", routine.id, { status: routine.status === "active" ? "paused" : "active", baseRevisionId: routine.latestRevisionId })).then(() => ignoreFailure(resource.refresh())))}>{t(routine.status === "active" ? "paperclip.pause" : "paperclip.ext.activate")}</Button><Button variant="ghost" size="small" leadingIcon={Pencil} disabled={!!busy} onClick={() => setEditor(routine)}>{t("paperclip.ext.edit")}</Button><Button variant="ghost" size="small" iconOnly leadingIcon={ArrowUpRight} aria-label={t("paperclip.fullInterface")} onClick={() => onOpen(`/routines/${routine.id}`)} /></div>
      </article>;
    })}</div>
  </ManagementFrame>;
}

function RoutineEditor({ routine, onClose, onSaved }: { routine: Routine | null; onClose: () => void; onSaved: (routine: Routine) => void }) {
  const { t } = useTranslation();
  const { companyId, agents, projects, busy, mutate } = usePaperclipStore();
  const [title, setTitle] = useState(routine?.title ?? ""); const [description, setDescription] = useState(routine?.description ?? "");
  const [assignee, setAssignee] = useState(routine?.assigneeAgentId ?? ""); const [project, setProject] = useState(routine?.projectId ?? "");
  const [concurrency, setConcurrency] = useState(routine?.concurrencyPolicy ?? "coalesce_if_active");
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(true);
  const readRevision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++readRevision.current; }; }, []);
  return <EditorFrame title={t(routine ? "paperclip.ext.editRoutine" : "paperclip.ext.newRoutine")} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (busy || !title.trim()) return;
      ++readRevision.current;
      ignoreFailure(mutate("routine-save", () => paperclipApi.request<Routine>(routine ? "updateRoutine" : "createRoutine", routine?.id ?? companyId, { title: title.trim(), description: description.trim() ? description : null, assigneeAgentId: assignee || null, projectId: project || null, concurrencyPolicy: concurrency,
        ...(routine ? { baseRevisionId: routine.latestRevisionId } : { status: "paused", catchUpPolicy: "skip_missed" }) })).then((value) => { if (mounted.current) { setSaved(true); onSaved({ ...value, triggers: routine?.triggers ?? [] }); } }, (error: unknown) => { if (mounted.current && !routine) setUncertain(true); throw error; }));
    }}><fieldset disabled={!!busy}>
      <label>{t("paperclip.ext.name")}<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>{t("paperclip.ext.routineInstructions")}<textarea required rows={4} maxLength={16000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="pc-form-grid"><label>{t("paperclip.assignee")}<PaperclipSelect aria-label={t("paperclip.assignee")} value={assignee} onValueChange={(value) => setAssignee(value)}><option value="">{t("paperclip.unassigned")}</option>{agents.filter((a) => a.status !== "terminated").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.project")}<PaperclipSelect aria-label={t("paperclip.project")} value={project} onValueChange={(value) => setProject(value)}><option value="">{t("paperclip.noProject")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.ext.concurrency")}<PaperclipSelect aria-label={t("paperclip.ext.concurrency")} value={concurrency} onValueChange={(value) => setConcurrency(value)}>{["coalesce_if_active", "skip_if_active", "always_enqueue"].map((v) => <option key={v} value={v}>{t(`paperclip.ext.concurrencyValue.${v}`)}</option>)}</PaperclipSelect></label></div>
      <div className="pc-form-bottom"><p>{t(uncertain ? "paperclip.ext.writeUncertain" : saved ? "paperclip.ext.definitionSaved" : "paperclip.ext.routinePausedHint")}</p><Button size="small" type="submit" disabled={!!busy || !title.trim() || !description.trim()}>{t("common.save")}</Button></div>
    </fieldset></form>
    {routine && <ScheduleEditor key={routine.id} routine={routine} onSaved={(triggers) => {
      if (!mounted.current) return;
      const current = ++readRevision.current;
      onSaved({ ...routine, triggers });
      // Trigger edits create a new routine revision. Reload its canonical
      // token without resetting the definition draft or resubmitting a save.
      ignoreFailure(paperclipApi.request<Routine>("routine", routine.id).then((value) => {
        if (mounted.current && current === readRevision.current) onSaved(value);
      }));
    }} />}
  </EditorFrame>;
}

function ScheduleEditor({ routine, onSaved }: { routine: Routine; onSaved: (schedules: Schedule[]) => void }) {
  const { t } = useTranslation();
  const { busy, mutate } = usePaperclipStore();
  const [selected, setSelected] = useState<Schedule | null>(null);
  const [expression, setExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [enabled, setEnabled] = useState(true);
  return <div className="pc-schedule-editor"><h4>{t("paperclip.ext.schedule")}</h4>
    <div className="pc-schedule-choices">{routine.triggers?.filter((s) => s.kind === "schedule").map((s) => <button key={s.id} aria-pressed={selected?.id === s.id} onClick={() => { setSelected(s); setExpression(s.cronExpression ?? ""); setTimezone(s.timezone ?? "UTC"); setEnabled(s.enabled); }}><code>{s.cronExpression}</code> · {s.timezone}</button>)}<button onClick={() => { setSelected(null); setExpression("0 9 * * *"); setEnabled(true); }}>{t("paperclip.ext.addSchedule")}</button></div>
    <form onSubmit={(e) => { e.preventDefault(); if (busy || !expression.trim() || !timezone.trim()) return;
      ignoreFailure(mutate("schedule-save", () => paperclipApi.request<{ trigger: Schedule } | Schedule>(selected ? "updateSchedule" : "createSchedule", selected?.id ?? routine.id,
        { ...(selected ? {} : { kind: "schedule" }), cronExpression: expression.trim(), timezone: timezone.trim(), enabled })).then((value) => {
        const trigger = "trigger" in value ? value.trigger : value;
        setSelected(trigger);
        onSaved([...(routine.triggers ?? []).filter((s) => s.id !== trigger.id), trigger]);
      }));
    }}><fieldset disabled={!!busy}><div className="pc-form-grid"><label>{t("paperclip.ext.cronPreset")}<PaperclipSelect aria-label={t("paperclip.ext.cronPreset")} value={["0 9 * * *", "0 * * * *", "0 9 * * 1"].includes(expression) ? expression : "custom"} onValueChange={(value) => setExpression(value === "custom" ? "" : value)}><option value="0 9 * * *">{t("paperclip.ext.daily")}</option><option value="0 * * * *">{t("paperclip.ext.hourly")}</option><option value="0 9 * * 1">{t("paperclip.ext.weekly")}</option><option value="custom">{t("paperclip.ext.custom")}</option></PaperclipSelect></label><label>{t("paperclip.ext.cron")}<input required value={expression} onChange={(e) => setExpression(e.target.value)} /></label><label>{t("paperclip.ext.timezone")}<input required value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label></div>
      <label className="pc-checkbox"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{t("paperclip.ext.scheduleEnabled")}</span></label><div className="pc-form-bottom"><p>{t("paperclip.ext.scheduleHint")}</p><Button size="small" type="submit" disabled={!!busy || !expression.trim() || !timezone.trim()}>{t("paperclip.ext.saveSchedule")}</Button></div></fieldset></form>
  </div>;
}
