import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageLimitProvider } from "@ccgui/plugin-sdk";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { withCredentialConsent } from "@/lib/credential-consent";
import { paperclipApi, type AgentCost, type QuotaAccount, type Run } from "./api";
import { AgentPortrait } from "./AgentPortrait";
import { PaperclipSelect } from "./PaperclipSelect";
import { errorMessage, ignoreFailure, ManagementFrame, usd } from "./management";
import { usePaperclipStore } from "./store";

type Period = "today" | "week" | "month";
export function usagePeriod(period: Period, now = new Date()) {
  const start = new Date(now);
  if (period === "month") { start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); }
  else if (period === "today") start.setHours(0, 0, 0, 0);
  else start.setTime(now.getTime() - 7 * 86400000);
  return { from: start.toISOString(), to: now.toISOString() };
}
export const totalTokens = (row: Pick<AgentCost, "inputTokens" | "cachedInputTokens" | "outputTokens">) => row.inputTokens + row.cachedInputTokens + row.outputTokens;
export function remainingPercent(used: number | null) { return used !== null && Number.isFinite(used) ? Math.max(0, 100 - Math.max(0, Math.min(100, used))) : null; }

/** Both credential-backed probes are user actions only. Mount, focus and
 * polling never request provider quota or a CLI login. */
export function QuotaPanel({ visible }: { visible: boolean }) {
  const { t, i18n } = useTranslation();
  const { companyId } = usePaperclipStore();
  const [accounts, setAccounts] = useState<QuotaAccount[] | null>(null);
  const [local, setLocal] = useState<UsageLimitProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeSource, setActiveSource] = useState<"managed" | "local">("managed");
  const revision = useRef(0);
  const feedback = useActionFeedback({ spin: true });
  useEffect(() => () => { ++revision.current; }, []);
  useEffect(() => { if (!visible) { ++revision.current; setBusy(false); } }, [visible]);
  const refresh = (source: "managed" | "local") => {
    if (busy || !visible) return;
    const current = ++revision.current;
    setActiveSource(source); setBusy(true); setError(null);
    ignoreFailure(feedback.start(async () => {
      try {
        if (source === "managed") {
          const value = await paperclipApi.request<QuotaAccount[]>("quotaWindows", companyId);
          if (current === revision.current) setAccounts(value);
          if (value.some((account) => !account.ok)) throw new Error(t("paperclip.usage.unavailable"));
        } else {
          const value = await withCredentialConsent(() => paperclipApi.codexLimits());
          const provider = value.providers.find((p) => p.id === "codex");
          if (current === revision.current) setLocal(provider ?? null);
          if (!provider || provider.status !== "ok") throw new Error(t("paperclip.usage.unavailable"));
        }
      } catch (e) { if (current === revision.current) setError(errorMessage(e)); throw e; }
      finally { if (current === revision.current) setBusy(false); }
    }));
  };
  const date = (value: string) => new Date(value).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows: QuotaAccount[] = [...(accounts ?? []), ...(local ? [{ provider: "openai", accountKey: "local-codex", accountLabel: `${t("paperclip.usage.localCodex")}${local.plan ? ` · ${local.plan}` : ""}`, ok: local.status === "ok", capturedAt: local.fetchedAt ? new Date(local.fetchedAt).toISOString() : undefined, errorFamily: local.status, windows: local.windows.map((w) => ({ label: w.label || (w.kind === "weekly" ? t("paperclip.usage.weekly") : w.kind === "session" ? t("paperclip.usage.session") : w.id), usedPercent: w.usedPercent, resetsAt: w.resetsAt ? new Date(w.resetsAt).toISOString() : null, valueLabel: null })) }] : [])];
  return <section className="pc-quota-section" aria-label={t("paperclip.usage.accountLimits")}>
    <div className="pc-management-heading"><div><h2>{t("paperclip.usage.accountLimits")}</h2><p>{t("paperclip.usage.sharedHint")}</p></div><div className="pc-toolbar-actions">
      <Button variant="secondary" size="small" disabled={busy || !visible} onClick={() => refresh("managed")}><span className="inline-flex items-center gap-2"><ActionFeedbackIcon icon={RefreshCw} feedback={activeSource === "managed" ? feedback.feedback : "idle"} spin />{t("paperclip.usage.checkLimits")}</span></Button>
      <Button variant="ghost" size="small" disabled={busy || !visible} onClick={() => refresh("local")}><span className="inline-flex items-center gap-2"><ActionFeedbackIcon icon={RefreshCw} feedback={activeSource === "local" ? feedback.feedback : "idle"} spin />{t("paperclip.usage.localCodex")}</span></Button>
    </div></div>
    <p className="pc-usage-note">{t("paperclip.usage.probeHint")}</p>
    {error && <div className="pc-alert" role="alert">{error}</div>}
    {accounts === null && local === null && <p className="pc-management-empty">{t("paperclip.usage.notChecked")}</p>}
    <div className="pc-quota-grid">{rows.map((account, index) => <article className="pc-quota-account" key={account.accountKey ?? `${account.provider}:${index}`}>
      <div className="pc-quota-title"><strong>{account.provider === "openai" ? "Codex" : account.provider === "anthropic" ? "Claude" : account.provider}</strong><span>{account.accountLabel ?? t("paperclip.usage.connectedAccount")}</span></div>
      {!account.ok && <p className="pc-usage-warning" role="status">{t(`paperclip.usage.status.${account.errorFamily ?? "unavailable"}`, { defaultValue: t("paperclip.usage.unavailable") })}</p>}
      {account.windows.map((window, i) => {
        const left = remainingPercent(window.usedPercent);
        const expired = !!window.resetsAt && new Date(window.resetsAt).getTime() <= Date.now();
        return <div className={`pc-quota-window ${left !== null && left <= 15 ? "pc-quota-low" : ""}`} key={`${window.label}:${i}`}>
          <div><span>{window.label}</span><strong>{left === null ? window.valueLabel || "—" : t("paperclip.usage.remaining", { value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(left) })}</strong></div>
          {left !== null && <div role="meter" aria-label={`${account.accountLabel ?? account.provider}: ${window.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={left} className="pc-quota-track"><span style={{ width: `${left}%` }} /></div>}
          <small>{expired ? t("paperclip.usage.resetPassed") : window.resetsAt ? t("paperclip.usage.resets", { time: date(window.resetsAt) }) : t("paperclip.usage.noReset")}{left !== null && <> · {t("paperclip.usage.used", { value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(100 - left) })}</>}</small>
        </div>;
      })}
      {account.ok && account.windows.length === 0 && <p className="pc-usage-note">{t("paperclip.usage.noWindows")}</p>}
      {account.capturedAt && <small className="pc-usage-note">{t("paperclip.usage.observed", { time: date(account.capturedAt) })}</small>}
    </article>)}</div>
    {local && <p className="pc-usage-note">{t("paperclip.usage.localHint")}</p>}
  </section>;
}

export function AgentSpend({ row, spentCents, onOpen }: { row?: AgentCost; spentCents: number; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  return <button className="pc-agent-spend" onClick={onOpen}><span>{t("paperclip.usage.monthSpend")}</span><strong>{usd(row?.costCents ?? spentCents, i18n.language)}<ArrowUpRight className="size-3" aria-hidden /></strong><small>{row ? `${new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 }).format(totalTokens(row))} ${t("paperclip.usage.tokens")}` : t("paperclip.usage.viewUsage")}</small></button>;
}

export function UsagePanel({ visible, agentId, onAgentChange }: { visible: boolean; agentId: string; onAgentChange: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  const { companyId, agents } = usePaperclipStore();
  const [period, setPeriod] = useState<Period>("month");
  const [snapshot, setSnapshot] = useState<{ period: Period; costs: AgentCost[]; runs: Run[]; fetchedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!visible) return;
    const current = ++revision.current;
    setLoading(true);
    try {
      const [costs, runs] = await Promise.all([
        paperclipApi.request<AgentCost[]>("costByAgent", companyId, usagePeriod(period)),
        paperclipApi.request<Run[]>("usageRuns", companyId, agentId ? { agentId } : {}),
      ]);
      if (current === revision.current) { setSnapshot({ period, costs, runs, fetchedAt: Date.now() }); setError(null); }
    } catch (e) { if (current === revision.current) setError(errorMessage(e)); throw e; }
    finally { if (current === revision.current) setLoading(false); }
  }, [visible, companyId, period, agentId]);
  useEffect(() => {
    if (!visible) return;
    ignoreFailure(refresh());
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") ignoreFailure(refresh()); }, 30_000);
    return () => { ++revision.current; window.clearInterval(timer); };
  }, [refresh, visible]);
  const costs = snapshot?.period === period ? snapshot.costs.filter((r) => !agentId || r.agentId === agentId) : [];
  const runs = snapshot?.period === period ? snapshot.runs.filter((r) => (!agentId || r.agentId === agentId) && new Date(r.startedAt ?? r.createdAt) >= new Date(usagePeriod(period).from)) : [];
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const tokens = costs.reduce((sum, row) => sum + totalTokens(row), 0);
  return <ManagementFrame title={t("paperclip.usage.title")} hint={t("paperclip.usage.accountingHint")} error={error} loading={loading} refresh={refresh} actions={<>
    <PaperclipSelect aria-label={t("paperclip.usage.period")} value={period} onValueChange={(v) => setPeriod(v as Period)}>{(["today", "week", "month"] as const).map((p) => <option key={p} value={p}>{t(`paperclip.usage.${p}`)}</option>)}</PaperclipSelect>
    <PaperclipSelect aria-label={t("paperclip.usage.agentFilter")} value={agentId} onValueChange={onAgentChange}><option value="">{t("paperclip.usage.allAgents")}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</PaperclipSelect>
  </>}>
    <div className="pc-usage-totals"><div><span>{t("paperclip.usage.tokens")}</span><strong>{snapshot?.period === period ? number(tokens) : "—"}</strong></div><div><span>{t("paperclip.usage.recordedCost")}</span><strong>{snapshot?.period === period ? usd(costs.reduce((sum, r) => sum + r.costCents, 0), i18n.language) : "—"}</strong></div><div><span>{t("paperclip.usage.subscriptionRuns")}</span><strong>{snapshot?.period === period ? number(costs.reduce((sum, r) => sum + r.subscriptionRunCount, 0)) : "—"}</strong></div></div>
    <div className="pc-usage-table-wrap"><table className="pc-usage-table"><caption>{t("paperclip.usage.byAgent")}</caption><thead><tr>{["agentFilter", "input", "cached", "output", "recordedCost"].map((key) => <th key={key} scope="col">{t(`paperclip.usage.${key}`)}</th>)}</tr></thead><tbody>{costs.map((row) => {
      const agent = agents.find((a) => a.id === row.agentId);
      return <tr key={row.agentId ?? "unassigned"}><th scope="row"><button onClick={() => onAgentChange(row.agentId ?? "")}>{agent && <AgentPortrait agent={agent} compact visible={visible} />}{row.agentName ?? t("paperclip.unassigned")}</button>{(row.estimatedEventCount > 0 || row.unpricedEventCount > 0) && <small className="pc-usage-warning">{t(row.unpricedEventCount > 0 ? "paperclip.usage.unpriced" : "paperclip.usage.estimated")}</small>}</th><td>{number(row.inputTokens)}</td><td>{number(row.cachedInputTokens)}</td><td>{number(row.outputTokens)}</td><td>{usd(row.costCents, i18n.language)}</td></tr>;
    })}</tbody></table></div>
    {!loading && !costs.length && <p className="pc-management-empty">{t("paperclip.usage.noUsage")}</p>}
    <h3 className="pc-usage-history-heading">{t("paperclip.usage.history")}</h3><p className="pc-usage-note">{t("paperclip.usage.historyHint")}</p>
    <div className="pc-usage-history">{runs.map((run) => {
      const agent = agents.find((a) => a.id === run.agentId);
      const usage = { inputTokens: run.usageJson?.inputTokens ?? run.inputTokens, cachedInputTokens: run.usageJson?.cachedInputTokens ?? run.cachedInputTokens, outputTokens: run.usageJson?.outputTokens ?? run.outputTokens };
      return <article key={run.id}><div>{agent && <AgentPortrait agent={agent} compact visible={visible} />}<strong>{agent?.name ?? run.agentId}</strong><time>{new Date(run.startedAt ?? run.createdAt).toLocaleString(i18n.language)}</time><span>{t(`paperclip.status.${run.status}`, { defaultValue: run.status })}</span></div><div><span>{t("paperclip.usage.input")}: {usage?.inputTokens == null ? "—" : number(usage.inputTokens)}</span><span>{t("paperclip.usage.cached")}: {usage?.cachedInputTokens == null ? "—" : number(usage.cachedInputTokens)}</span><span>{t("paperclip.usage.output")}: {usage?.outputTokens == null ? "—" : number(usage.outputTokens)}</span><span>{run.costUsd == null ? t("paperclip.usage.costUnknown") : usd(run.costUsd * 100, i18n.language)}</span></div></article>;
    })}</div>
    {!loading && !runs.length && <p className="pc-management-empty">{t("paperclip.noRuns")}</p>}
    {snapshot && <p className="pc-usage-note">{t("paperclip.usage.observed", { time: new Date(snapshot.fetchedAt).toLocaleTimeString(i18n.language) })}</p>}
  </ManagementFrame>;
}
