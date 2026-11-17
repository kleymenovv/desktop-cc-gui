import { PaperclipSelect } from "./PaperclipSelect";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { paperclipApi, type BudgetOverview, type BudgetPolicy } from "./api";
import { usePaperclipStore } from "./store";
import { dollarCents, EditorFrame, ignoreFailure, ManagementEmpty, ManagementFrame, usd, useManagementResource } from "./management";

export function BudgetsPanel({ visible }: { visible: boolean }) {
  const { t, i18n } = useTranslation();
  const { busy } = usePaperclipStore();
  const resource = useManagementResource<BudgetOverview>("budgets", visible);
  const [editor, setEditor] = useState<BudgetPolicy | "new" | null>(null);
  return <ManagementFrame title={t("paperclip.ext.budgets")} hint={t("paperclip.ext.budgetsHint")} error={resource.error} loading={resource.loading} refresh={resource.refresh} actions={<Button size="small" leadingIcon={Plus} disabled={!!busy} onClick={() => setEditor("new")}>{t("paperclip.ext.newBudget")}</Button>}>
    {editor && <BudgetEditor key={editor === "new" ? "new" : editor.policyId} policy={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); ignoreFailure(resource.refresh()); }} />}
    {!!resource.data?.activeIncidents.length && <div className="pc-budget-incidents"><h3>{t("paperclip.ext.budgetIncidents")}</h3>{resource.data.activeIncidents.map((incident) => <p key={incident.id}>{incident.scopeName} · {t(`paperclip.ext.value.${incident.thresholdType}`, { defaultValue: incident.thresholdType })} · {t(`paperclip.ext.value.${incident.status}`, { defaultValue: incident.status })}</p>)}<p>{t("paperclip.ext.incidentHint")}</p></div>}
    {resource.data?.policies.length === 0 && <ManagementEmpty>{t("paperclip.ext.noBudgets")}</ManagementEmpty>}
    <div className="pc-budget-grid">{resource.data?.policies.map((policy) => <article key={policy.policyId} className="pc-budget-card">
      <div className="pc-resource-top"><Wallet className="size-5" aria-hidden /><span className={`pc-budget-health pc-budget-health-${policy.status}`}>{t(`paperclip.ext.value.${policy.status}`, { defaultValue: policy.status })}</span></div>
      <h3>{policy.scopeName}</h3><p className="pc-resource-state">{t(`paperclip.ext.scope.${policy.scopeType}`)} · {t(policy.windowKind === "lifetime" ? "paperclip.ext.lifetime" : "paperclip.ext.monthlyUtc")}</p>
      <div className="pc-budget-amount"><strong>{usd(policy.observedAmount, i18n.language)}</strong><span>/ {usd(policy.amount, i18n.language)}</span></div>
      <p className="pc-muted">{t("paperclip.ext.budgetUtilization", { percent: Math.round(policy.utilizationPercent) })}</p>
      <div className="pc-resource-meta"><span>{t(policy.hardStopEnabled ? "paperclip.ext.hardStopOn" : "paperclip.ext.hardStopOff")}</span><span>{t(policy.isActive ? "paperclip.ext.policyEnabled" : "paperclip.ext.policyDisabled")}</span>{policy.unpricedEventCount > 0 && <span>{t("paperclip.ext.unpriced", { count: policy.unpricedEventCount })}</span>}{policy.paused && <span>{t("paperclip.ext.budgetPaused")}</span>}</div>
      <div className="pc-resource-actions"><Button variant="secondary" size="small" leadingIcon={Pencil} disabled={!!busy} onClick={() => setEditor(policy)}>{t("paperclip.ext.edit")}</Button></div>
    </article>)}</div>
  </ManagementFrame>;
}

function BudgetEditor({ policy, onClose, onSaved }: { policy: BudgetPolicy | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { companyId, companies, agents, projects, busy, mutate } = usePaperclipStore();
  const [scope, setScope] = useState(policy?.scopeType ?? "company"); const [scopeId, setScopeId] = useState(policy?.scopeId ?? companyId);
  const [windowKind, setWindow] = useState(policy?.windowKind ?? "calendar_month_utc");
  const [amount, setAmount] = useState(policy ? (policy.amount / 100).toFixed(2) : "");
  const [warn, setWarn] = useState(String(policy?.warnPercent ?? 80));
  const [hardStop, setHardStop] = useState(policy?.hardStopEnabled ?? true);
  const [unpriced, setUnpriced] = useState(policy?.unpricedUsagePolicy ?? "block");
  const [enabled, setEnabled] = useState(policy?.isActive ?? true);
  const cents = dollarCents(amount);
  const availableScopes = scope === "company" ? companies.filter((c) => c.id === companyId) : scope === "agent" ? agents : projects;
  const scopes = policy && !availableScopes.some((s) => s.id === policy.scopeId)
    ? [...availableScopes, { id: policy.scopeId, name: policy.scopeName }] : availableScopes;
  const valid = cents !== null && cents > 0 && Number.isInteger(Number(warn)) && Number(warn) >= 1 && Number(warn) <= 99 && scopes.some((s) => s.id === scopeId);
  return <EditorFrame title={t(policy ? "paperclip.ext.editBudget" : "paperclip.ext.newBudget")} onClose={onClose}><form onSubmit={(e) => {
    e.preventDefault(); if (busy || !valid) return;
    ignoreFailure(mutate("budget-save", () => paperclipApi.request("saveBudget", companyId, { scopeType: scope, scopeId, metric: "billed_cents", windowKind, amount: cents, warnPercent: Number(warn), hardStopEnabled: hardStop, unpricedUsagePolicy: unpriced, isActive: enabled })).then(onSaved));
  }}><fieldset disabled={!!busy}>
    <div className="pc-form-grid"><label>{t("paperclip.ext.budgetScope")}<PaperclipSelect aria-label={t("paperclip.ext.budgetScope")} value={scope} disabled={!!policy} onValueChange={(value) => { setScope(value); setScopeId(value === "company" ? companyId : ""); }}>{["company", "agent", "project"].map((v) => <option key={v} value={v}>{t(`paperclip.ext.scope.${v}`)}</option>)}</PaperclipSelect></label><label>{t("paperclip.ext.budgetTarget")}<PaperclipSelect aria-label={t("paperclip.ext.budgetTarget")} value={scopeId} disabled={!!policy} required onValueChange={(value) => setScopeId(value)}><option value="">{t("paperclip.ext.choose")}</option>{scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</PaperclipSelect></label><label>{t("paperclip.ext.budgetWindow")}<PaperclipSelect aria-label={t("paperclip.ext.budgetWindow")} value={windowKind} disabled={!!policy} onValueChange={(value) => setWindow(value)}><option value="calendar_month_utc">{t("paperclip.ext.monthlyUtc")}</option><option value="lifetime">{t("paperclip.ext.lifetime")}</option></PaperclipSelect></label></div>
    <div className="pc-form-grid pc-form-grid-two"><label>{t("paperclip.ext.amountUsd")}<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" /></label><label>{t("paperclip.ext.warningPercent")}<input type="number" min={1} max={99} required value={warn} onChange={(e) => setWarn(e.target.value)} /></label></div>
    <label className="pc-checkbox"><input type="checkbox" checked={hardStop} onChange={(e) => setHardStop(e.target.checked)} /><span><strong>{t("paperclip.ext.hardStopOn")}</strong><small>{t("paperclip.ext.hardStopHint")}</small></span></label>
    <label>{t("paperclip.ext.unpricedPolicy")}<PaperclipSelect aria-label={t("paperclip.ext.unpricedPolicy")} value={unpriced} onValueChange={(value) => setUnpriced(value as "block" | "allow")}><option value="block">{t("paperclip.ext.blockUnpriced")}</option><option value="allow">{t("paperclip.ext.allowUnpriced")}</option></PaperclipSelect></label>
    <label className="pc-checkbox"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{t("paperclip.ext.policyEnabled")}</span></label>
    <div className="pc-form-bottom"><p>{t("paperclip.ext.budgetSaveHint")}</p><Button size="small" type="submit" disabled={!!busy || !valid}>{t("common.save")}</Button></div>
  </fieldset></form></EditorFrame>;
}
