import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const STORAGE_KEY = "paperclip:task-detail-width";
const MIN_DETAIL = 320;
const MIN_LIST = 280;
const HANDLE = 8;
function readWidth(): number | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); const width = raw === null ? NaN : Number(raw); return Number.isFinite(width) && width > 0 ? width : null; } catch { return null; }
}
export function detailBounds(container: number) { return { min: Math.min(MIN_DETAIL, Math.max(0, container - HANDLE)), max: Math.max(MIN_DETAIL, container - MIN_LIST - HANDLE) }; }
export function detailWidth(preferred: number | null, container: number) {
  const bounds = detailBounds(container);
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, preferred ?? Math.max(330, Math.min(560, container * .44)))));
}

/** The divider owns pointer capture; no document listeners, cursor overrides or
 * task remounts are needed. Only a completed drag writes the UI preference. */
export function TaskSplit({ children, detail, visible, listFocused = false }: { listFocused?: boolean; children: ReactNode; detail: ReactNode; visible: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(readWidth);
  const preferredRef = useRef(preferred);
  const [container, setContainer] = useState(0);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number; preferred: number | null } | null>(null);
  const change = (width: number | null) => { preferredRef.current = width; setPreferred(width); };
  const persist = (width: number | null) => { try { if (width === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* Layout still works when storage is unavailable. */ } };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setContainer(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if ((!visible || !detail) && drag.current) { change(drag.current.preferred); drag.current = null; setResizing(false); }
  }, [visible, detail]);
  const width = detailWidth(preferred, container);
  const bounds = detailBounds(container);
  const stop = (cancel: boolean) => {
    if (!drag.current) return;
    if (cancel) change(drag.current.preferred);
    else persist(preferredRef.current);
    drag.current = null; setResizing(false);
  };
  return <div ref={ref} className={`pc-workspace ${detail ? "pc-has-detail" : ""} ${listFocused ? "pc-list-focused" : ""} ${container > 0 && container <= 760 ? "pc-task-stacked" : ""}`} data-resizing={resizing || undefined} style={container > 0 ? { "--pc-detail-width": `${width}px` } as CSSProperties : undefined}>
    {children}
    {detail && <div role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={t("paperclip.resizeDetail")} title={t("paperclip.resizeDetailHint")}
      aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width}
      className="pc-task-divider"
      onPointerDown={(event) => {
        if (event.button !== 0 || !visible) return;
        event.preventDefault(); event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width, preferred: preferredRef.current };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        change(detailWidth(start.width - (event.clientX - start.x), ref.current?.getBoundingClientRect().width ?? container));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        stop(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => stop(true)} onLostPointerCapture={() => stop(true)}
      onDoubleClick={() => { stop(true); change(null); persist(null); }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : width + (event.key === "ArrowLeft" ? 24 : -24);
        const value = detailWidth(next, container); change(value); persist(value);
      }}
    ><span /></div>}
    {detail}
  </div>;
}
