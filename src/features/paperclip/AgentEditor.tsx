import { AgentPortrait } from "./AgentPortrait";
import { PaperclipSelect } from "./PaperclipSelect";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { paperclipApi, type AgentConfiguration, type AgentInstructionFile } from "./api";
import { usePaperclipStore } from "./store";
import { EditorFrame, errorMessage, ignoreFailure } from "./management";

export const roles = ["ceo", "cto", "cmo", "cfo", "security", "engineer", "designer", "pm", "qa", "devops", "researcher", "general"];
const adapters = ["claude_local", "codex_local", "opencode_local", "gemini_local", "pi_local", "cursor"];

export function AgentEditor({ id, visible, onClose }: { id: string | null; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const agent = usePaperclipStore((s) => s.agents.find((a) => a.id === id));
  const [configuration, setConfiguration] = useState<AgentConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id || !visible || configuration) return;
    let active = true;
    paperclipApi.request<AgentConfiguration>("agentConfiguration", id).then(
      (value) => { if (active) { setConfiguration(value); setError(null); } },
      (e: unknown) => { if (active) setError(errorMessage(e)); },
    );
    return () => { active = false; };
  }, [id, visible, retry, configuration]);
  return <EditorFrame title={t(id ? "paperclip.ext.editAgent" : "paperclip.ext.newAgent")} onClose={onClose}>
    {agent && <div className="pc-agent-identity"><AgentPortrait agent={agent} visible={visible} /><div><strong>{agent.name}</strong><span>{t(`paperclip.ext.roleName.${agent.role}`, { defaultValue: agent.role })}</span></div></div>}
    {error && <div className="pc-alert" role="alert">{error}<button className="pc-text-link" onClick={() => setRetry(retry + 1)}>{t("paperclip.retry")}</button></div>}
    {id && !configuration ? <p className="pc-muted">{t("common.loading")}</p> : <AgentForm key={id ?? "new"} configuration={configuration} onClose={onClose} />}
    {id && configuration && <InstructionsEditor id={id} />}
  </EditorFrame>;
}

function InstructionsEditor({ id }: { id: string }) {
  const { t } = useTranslation();
  const { busy, mutate } = usePaperclipStore();
  const [file, setFile] = useState<AgentInstructionFile | null>(null);
  const [content, setContent] = useState(""); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const bundle = await paperclipApi.request<{ entryFile: string; resolvedEntryPath: string | null }>("agentInstructions", id);
      const value = await paperclipApi.request<AgentInstructionFile>("agentInstructionFile", id, { path: bundle.entryFile });
      setFile(value); setContent(value.content); setLocation(bundle.resolvedEntryPath ?? value.path);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  };
  return <div className="pc-schedule-editor"><h4>{t("paperclip.ext.instructions")}</h4>
    {error && <div className="pc-alert" role="alert">{error}</div>}
    {!file ? <Button variant="secondary" size="small" disabled={loading || !!busy} onClick={() => ignoreFailure(load())}>{t(loading ? "common.loading" : "paperclip.ext.loadInstructions")}</Button> : <form onSubmit={(e) => {
      e.preventDefault(); if (busy || !file.editable || content === file.content) return;
      ignoreFailure(mutate("instructions-save", () => paperclipApi.request<AgentInstructionFile>("saveAgentInstructions", id, { path: file.path, content, baseHash: file.contentHash, baseRevisionId: file.revision?.id ?? null })).then((saved) => { setFile(saved); setContent(saved.content); }));
    }}><fieldset disabled={!!busy}><code className="pc-instruction-path">{location}</code><label>{t("paperclip.ext.instructions")}<textarea rows={10} maxLength={16000} readOnly={!file.editable} value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <div className="pc-form-bottom"><p>{t(file.editable ? "paperclip.ext.instructionSaveHint" : "paperclip.ext.instructionsReadOnly")}</p><Button type="submit" size="small" disabled={!!busy || !file.editable || content === file.content}>{t("common.save")}</Button></div>
    </fieldset></form>}
  </div>;
}

function AgentForm({ configuration: saved, onClose }: { configuration: AgentConfiguration | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { companyId, agents, busy, mutate } = usePaperclipStore();
  const [name, setName] = useState(saved?.name ?? ""); const [title, setTitle] = useState(saved?.title ?? "");
  const [role, setRole] = useState(saved?.role ?? "engineer"); const [reportsTo, setReportsTo] = useState(saved?.reportsTo ?? "");
  const [capabilities, setCapabilities] = useState(saved?.capabilities ?? "");
  const [adapter, setAdapter] = useState(saved?.adapterType ?? "codex_local");
  const [model, setModel] = useState(saved?.adapterConfig.model ?? ""); const [cwd, setCwd] = useState(saved?.adapterConfig.cwd ?? "");
  const [instructions, setInstructions] = useState("");
  const [heartbeat, setHeartbeat] = useState(saved?.runtimeConfig.heartbeat?.enabled ?? false);
  const [interval, setInterval] = useState(String(saved?.runtimeConfig.heartbeat?.intervalSec ?? 300));
  const [uncertain, setUncertain] = useState(false);
  const descendants = new Set(saved ? [saved.id] : []);
  for (let pass = 0; pass < agents.length; pass++) for (const a of agents) if (a.reportsTo && descendants.has(a.reportsTo)) descendants.add(a.id);
  const heartbeatChanged = !saved || heartbeat !== (saved.runtimeConfig.heartbeat?.enabled ?? false) || Number(interval) !== (saved.runtimeConfig.heartbeat?.intervalSec ?? 300);
  const validInterval = !heartbeat || (Number.isInteger(Number(interval)) && Number(interval) >= 60 && Number(interval) <= 86400);
  return <form onSubmit={(event) => {
    event.preventDefault(); if (busy || !name.trim() || !validInterval) return;
    const adapterPatch = {
      ...(!saved || model !== (saved.adapterConfig.model ?? "") ? { model: model.trim() || null } : {}),
      ...(!saved || cwd !== (saved.adapterConfig.cwd ?? "") ? { cwd: cwd.trim() || null } : {}),
    };
    const body = { name: name.trim(), title: title.trim() || null, role, reportsTo: reportsTo || null, capabilities: capabilities.trim() || null,
      ...(saved ? { expectedConfigurationRevision: saved.configurationRevision } : { adapterType: adapter }),
      ...(Object.keys(adapterPatch).length ? { adapterConfig: adapterPatch } : {}),
      ...(heartbeatChanged ? { runtimeConfig: { heartbeat: { enabled: heartbeat, intervalSec: Number(interval) || 300 } } } : {}),
      ...(!saved && instructions.trim() ? { instructionsBundle: { entryFile: "AGENTS.md", files: { "AGENTS.md": instructions } } } : {}) };
    ignoreFailure(mutate("agent-settings", () => paperclipApi.request(saved ? "updateAgent" : "createAgent", saved?.id ?? companyId, body)).then(onClose, (e: unknown) => { setUncertain(true); throw e; }));
  }}><fieldset disabled={!!busy}>
    <div className="pc-form-grid"><label>{t("paperclip.ext.name")}<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label><label>{t("paperclip.ext.jobTitle")}<input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>{t("paperclip.ext.role")}<PaperclipSelect aria-label={t("paperclip.ext.role")} value={role} onValueChange={(value) => setRole(value)}>{roles.map((r) => <option key={r} value={r}>{t(`paperclip.ext.roleName.${r}`, { defaultValue: r })}</option>)}</PaperclipSelect></label></div>
    <label>{t("paperclip.ext.manager")}<PaperclipSelect aria-label={t("paperclip.ext.manager")} value={reportsTo} onValueChange={(value) => setReportsTo(value)}><option value="">{t("paperclip.ext.noManager")}</option>{agents.filter((a) => !descendants.has(a.id) && a.status !== "terminated").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect></label>
    <label>{t("paperclip.ext.capabilities")}<textarea rows={3} maxLength={6000} value={capabilities} onChange={(e) => setCapabilities(e.target.value)} /></label>
    <div className="pc-form-grid pc-form-grid-two"><label>{t("paperclip.ext.runtime")}<PaperclipSelect aria-label={t("paperclip.ext.runtime")} value={adapter} disabled={!!saved} onValueChange={(value) => setAdapter(value)}>{[...new Set([...adapters, adapter])].map((a) => <option key={a} value={a}>{a.replaceAll("_", " ")}</option>)}</PaperclipSelect><small>{t("paperclip.ext.runtimeHint")}</small></label><label>{t("paperclip.ext.model")}<input maxLength={512} value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("paperclip.ext.defaultModel")} /></label></div>
    <label>{t("paperclip.ext.workspace")}<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/…/Projects/…" /></label>
    {!saved && <label>{t("paperclip.ext.instructions")}<textarea rows={5} maxLength={18000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("paperclip.ext.instructionsHint")} /></label>}
    <label className="pc-checkbox"><input type="checkbox" checked={heartbeat} onChange={(e) => setHeartbeat(e.target.checked)} /><span><strong>{t("paperclip.ext.heartbeat")}</strong><small>{t("paperclip.ext.heartbeatHint")}</small></span></label>
    {heartbeat && <label>{t("paperclip.ext.intervalSeconds")}<input type="number" min={60} max={86400} step={1} required value={interval} onChange={(e) => setInterval(e.target.value)} /></label>}
    <div className="pc-form-bottom"><p>{t(uncertain ? "paperclip.ext.writeUncertain" : "paperclip.ext.agentSaveHint")}</p><Button type="submit" size="small" disabled={!!busy || !name.trim() || !validInterval}>{t("common.save")}</Button></div>
  </fieldset></form>;
}
