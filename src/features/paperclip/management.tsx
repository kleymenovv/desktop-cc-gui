import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { paperclipApi, type ManagementAction } from "./api";
import { usePaperclipStore } from "./store";

export const ignoreFailure = (promise: Promise<unknown>) => { void promise.catch(() => {}); };
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Each management view owns its read lifecycle. Polling never resets editor
 * drafts; company changes, hidden views and newer requests invalidate reads. */
export function useManagementResource<T>(action: ManagementAction, visible: boolean) {
  const companyId = usePaperclipStore((s) => s.companyId);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!companyId || !visible) return;
    const current = ++revision.current;
    setLoading(true);
    try {
      const value = await paperclipApi.request<T>(action, companyId);
      if (current === revision.current) { setData(value); setError(null); }
    } catch (e) {
      if (current === revision.current) setError(errorMessage(e));
      throw e;
    } finally { if (current === revision.current) setLoading(false); }
  }, [action, companyId, visible]);
  useEffect(() => {
    if (!visible) return;
    ignoreFailure(refresh());
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && !usePaperclipStore.getState().busy) ignoreFailure(refresh());
    }, 10_000);
    return () => { ++revision.current; window.clearInterval(timer); };
  }, [refresh, visible]);
  return { data, error, loading, refresh };
}

export function ManagementFrame({ title, hint, error, loading, refresh, actions, children }: {
  title: string; hint?: string; error?: string | null; loading?: boolean; refresh?: () => Promise<unknown>;
  actions?: ReactNode; children: ReactNode;
}) {
  const { t } = useTranslation();
  const feedback = useActionFeedback({ spin: true });
  return <div className="pc-management">
    <div className="pc-management-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div><div className="pc-toolbar-actions">
      {refresh && <Button variant="ghost" size="small" iconOnly aria-label={t("paperclip.refresh")} disabled={loading || feedback.feedback === "running"} onClick={() => ignoreFailure(feedback.start(refresh))}><ActionFeedbackIcon icon={RefreshCw} feedback={feedback.feedback} spin /></Button>}{actions}
    </div></div>
    {error && <div className="pc-alert" role="alert">{error}</div>}
    {loading && <div className="pc-inline-loading" role="status"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t("common.loading")}</div>}
    {children}
  </div>;
}

export function EditorFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const busy = usePaperclipStore((s) => s.busy);
  return <section className="pc-management-editor"><div className="pc-form-title"><h3>{title}</h3><Button variant="ghost" size="small" iconOnly leadingIcon={X} aria-label={t("common.close")} disabled={!!busy} onClick={onClose} /></div>{children}</section>;
}

export function ManagementEmpty({ children }: { children: ReactNode }) {
  return <div className="pc-management-empty">{children}</div>;
}

export function usd(cents: number, language: string) {
  return new Intl.NumberFormat(language, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
}

export function dollarCents(value: string): number | null {
  // Preserve cents exactly; reject rounding, exponent notation and overflow.
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}

export function changedFields(before: object, after: Record<string, unknown>): Record<string, unknown> {
  const original = before as Record<string, unknown>;
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(original[key] ?? null) !== JSON.stringify(value ?? null)));
}
