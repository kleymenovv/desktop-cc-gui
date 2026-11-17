import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, ArrowDown, Brain, CheckCircle2, CircleAlert, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { AgentPortrait } from "./AgentPortrait";
import { paperclipApi, type ActivityPage, type LiveRun } from "./api";
import { liveStatus, mergeActivity, type ActivityRow } from "./activity";
import { errorMessage } from "./management";
import { usePaperclipStore } from "./store";

const background = () => document.visibilityState === "hidden";

interface RunActivity { run: LiveRun; rows: ActivityRow[]; cursor: number; settled: boolean; hasMore: boolean; error: string | null }

/** Independent from comment/draft refreshes. Reads are sequential per run,
 * bounded per tick, and made inert on issue/view changes. No raw logs or
 * speculative "thinking" activity is synthesized. */
export function IssueActivity(props: { id: string; visible: boolean }) {
  return <IssueActivityState key={props.id} {...props} />;
}

function IssueActivityState({ id, visible }: { id: string; visible: boolean }) {
  const { t } = useTranslation();
  const records = useRef(new Map<string, RunActivity>());
  const [runs, setRuns] = useState<RunActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [now, setNow] = useState(Date.now);
  const running = runs.some((r) => liveStatus(r.run.status));
  const working = runs.some((r) => r.run.status === "running");
  useEffect(() => {
    if (!visible || !running) return;
    const clock = window.setInterval(() => { if (!background()) setNow(Date.now()); }, 1000);
    return () => window.clearInterval(clock);
  }, [visible, running]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false, inFlight = false;
    let timer = 0;
    const publish = () => { if (!cancelled) setRuns([...records.current.values()].map((r) => ({ ...r }))); };
    const tick = async () => {
      if (cancelled || inFlight) return;
      window.clearTimeout(timer);
      if (background()) { timer = window.setTimeout(() => void tick(), 3000); return; }
      inFlight = true;
      let failed = false;
      try {
        const [liveResult, executionResult] = await Promise.allSettled([
          paperclipApi.request<LiveRun[]>("issueLiveRuns", id),
          paperclipApi.request<{ runId: string; agentId: string } | null>("issueExecution", id),
        ]);
        if (cancelled || background()) return;
        if (liveResult.status === "rejected") throw liveResult.reason;
        const live = liveResult.value;
        const execution = executionResult.status === "fulfilled" ? executionResult.value : null;
        setOverflow(live.length > 6);
        const liveIds = new Set(live.map((r) => r.id));
        const ids = [...new Set([...live.map((r) => r.id), ...(execution?.runId ? [execution.runId] : []), ...records.current.keys()])].slice(0, 6);
        const retained = new Map(ids.flatMap((runId) => { const record = records.current.get(runId); return record ? [[runId, record] as const] : []; }));
        records.current = retained;
        for (const run of live.slice(0, 6)) {
          const previous = retained.get(run.id);
          retained.set(run.id, previous ? { ...previous, run } : { run, rows: [], cursor: 0, settled: false, hasMore: true, error: null });
        }
        publish();
        const missing = ids.filter((runId) => !liveIds.has(runId) && (!retained.has(runId) || liveStatus(retained.get(runId)!.run.status)));
        await Promise.all(missing.map(async (runId) => {
          try {
            const run = await paperclipApi.request<LiveRun>("runStatus", runId);
            if (cancelled) return;
            const previous = retained.get(runId);
            retained.set(runId, previous ? { ...previous, run } : { run, rows: [], cursor: 0, settled: false, hasMore: true, error: null });
          } catch (e) {
            if (cancelled) return;
            throw e;
          }
        }));
        if (cancelled || background()) return;
        await Promise.all([...retained.values()].map(async (record) => {
          if (record.settled && !record.hasMore && !liveStatus(record.run.status)) return;
          try {
            for (let page = 0; page < 4; page++) {
              if (cancelled || background()) return;
              const value = await paperclipApi.request<ActivityPage>("runEvents", record.run.id, { afterSeq: record.cursor });
              if (cancelled) return;
              if (value.hasMore && value.nextSeq <= record.cursor) throw new Error("Paperclip event cursor did not advance");
              record.rows = mergeActivity(record.rows, value.events.filter((e) => e.seq > record.cursor));
              record.cursor = Math.max(record.cursor, value.nextSeq); record.hasMore = value.hasMore;
              record.settled = !liveStatus(record.run.status) && !value.hasMore; record.error = null;
              publish();
              if (!value.hasMore) break;
            }
          } catch (e) { if (!cancelled) record.error = errorMessage(e); }
        }));
        if (!cancelled) { publish(); setError(executionResult.status === "rejected" ? errorMessage(executionResult.reason) : null); setLoaded(true); setNow(Date.now()); }
      } catch (e) { failed = true; if (!cancelled) { setError(errorMessage(e)); setLoaded(true); } }
      finally {
        inFlight = false;
        if (!cancelled) timer = window.setTimeout(() => void tick(), failed ? 5000 : [...records.current.values()].some((r) => r.hasMore && !r.error) ? 150 : [...records.current.values()].some((r) => liveStatus(r.run.status)) ? 1500 : 5000);
      }
    };
    const foreground = () => { if (!background()) void tick(); };
    void tick(); document.addEventListener("visibilitychange", foreground);
    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", foreground); };
  }, [id, visible]);
  return <section className="pc-live-section" aria-label={t("paperclip.live.title")}>
    <div className="pc-live-heading"><h3><Activity className="size-4" aria-hidden />{t("paperclip.live.title")}</h3>{running && !error && <span className={`pc-live-badge ${working ? "" : "pc-live-badge-queued"}`}><span />{t(working ? "paperclip.live.connected" : "paperclip.live.queued")}</span>}</div>
    {error && <div className="pc-alert" role="alert">{t("paperclip.live.syncError")} {error}</div>}
    {!loaded && !runs.length && <p className="pc-live-empty"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t("common.loading")}</p>}
    {loaded && !runs.length && !error && <p className="pc-live-empty">{t("paperclip.live.noRun")}</p>}
    {overflow && <p className="pc-usage-note">{t("paperclip.live.runLimit")}</p>}
    {loaded && !running && runs.length > 0 && !error && <p className="pc-usage-note">{t("paperclip.live.latestRun")}</p>}
    {runs.map((record) => <RunFeed key={record.run.id} record={record} now={now} visible={visible} />)}
  </section>;
}

function RunFeed({ record, now, visible }: { record: RunActivity; now: number; visible: boolean }) {
  const { t, i18n } = useTranslation();
  const { run, rows, error, hasMore } = record;
  const agent = usePaperclipStore((s) => s.agents.find((a) => a.id === run.agentId));
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [behind, setBehind] = useState(false);
  const signature = Math.max(0, ...rows.map((row) => row.seq));
  useLayoutEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    else setBehind(true);
  }, [signature]);
  const active = liveStatus(run.status);
  const start = new Date(run.startedAt ?? run.createdAt).getTime();
  const seconds = Math.max(0, Math.floor(((active ? now : new Date(run.finishedAt ?? now).getTime()) - start) / 1000));
  const duration = Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—";
  const lastEvent = run.lastEventAt || run.lastOutputAt;
  const statusKey = run.status === "running" ? "working" : run.status === "queued" || run.status === "deferred" ? "queued" : run.status === "succeeded" ? "completed" : run.status === "failed" || run.status === "timed_out" ? "failed" : "stopped";
  const hint = run.currentStatusMessage || (run.currentToolName ? t("paperclip.live.currentTool", { name: run.currentToolName }) : !rows.some((r) => r.kind === "message" && r.text) ? run.lastAssistantSnippet : null);
  return <article className={`pc-live-run pc-live-run-${statusKey}`}>
    <header><div>{agent ? <AgentPortrait agent={agent} compact visible={visible} /> : <Activity className="size-4" aria-hidden />}<strong>{agent?.name ?? run.agentName ?? t("paperclip.agent")}</strong></div><span>{active ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : statusKey === "failed" ? <CircleAlert className="size-3" aria-hidden /> : <CheckCircle2 className="size-3" aria-hidden />}{t(`paperclip.live.${statusKey}`)} · {duration}</span></header>
    {hint && <p className="pc-live-current">{hint}</p>}
    {run.livenessState && /wait|stall|blocked/.test(run.livenessState) && <p className="pc-usage-warning">{t("paperclip.live.waiting")} {run.nextAction}</p>}
    {run.error && <p className="pc-live-error">{run.error}</p>}
    {error && <p className="pc-live-error" role="alert">{t("paperclip.live.syncError")} {error}</p>}
    {!rows.length && <p className="pc-live-empty">{t(run.status === "running" ? "paperclip.live.awaitEvents" : active ? "paperclip.live.awaitStart" : "paperclip.live.noEvents")}</p>}
    {!!rows.length && <div ref={feed} className="pc-live-feed" role="log" aria-live="off" aria-label={t("paperclip.live.events")} onScroll={() => {
      const element = feed.current; if (!element) return;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      if (follow.current) setBehind(false);
    }}>{rows.map((row) => <div className={`pc-live-row pc-live-row-${row.kind} pc-live-row-${row.status}`} key={row.id}>
      {row.kind === "message" ? <p>{row.text}</p> : row.kind === "reasoning" ? <details><summary><Brain className="size-3.5" aria-hidden />{t("paperclip.live.thought")}<span>{row.text.split("\n")[0]}</span></summary><p>{row.text}</p></details> : row.kind === "tool" ? <div><Wrench className="size-3.5" aria-hidden /><strong>{row.name || t("paperclip.live.tool")}</strong><span>{t(row.status === "failed" ? "paperclip.live.failed" : row.status === "completed" ? "paperclip.live.completed" : "paperclip.live.runningTool")}</span></div> : row.text ? <p>{row.text}</p> : null}
      {row.truncated && <small>{t("paperclip.live.fragment")}</small>}
    </div>)}</div>}
    {hasMore && <p className="pc-usage-note">{t("paperclip.live.loadingHistory")}</p>}
    {behind && <div className="pc-live-follow"><Button variant="secondary" size="small" leadingIcon={ArrowDown} onClick={() => { follow.current = true; setBehind(false); if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }}>{t("paperclip.live.latest")}</Button></div>}
    <footer><time>{t("paperclip.live.started", { time: new Date(run.startedAt ?? run.createdAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }) })}</time>{lastEvent && <time>{t("paperclip.live.lastEvent", { time: new Date(lastEvent).toLocaleTimeString(i18n.language) })}</time>}<span>{t("paperclip.live.bufferHint")}</span></footer>
  </article>;
}
