import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { relativeTime } from "@/features/chat/time";
import { computeGraph, laneColor } from "./history-graph";
import { useGitStore } from "./store";

const ROW_H = 44;
const LANE_W = 14;
const PAD = 10;
const DOT_R = 4.5;

/** Rough branch-history visualization: commits newest-first with lane
 *  connectors derived from parent ids (see history-graph.ts). */
export function GitHistoryDialog({
  workspacePath,
  onClose,
}: {
  workspacePath: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const commits = useGitStore((s) => s.logByWorkspace[workspacePath]);

  useEffect(() => {
    void useGitStore.getState().loadLog(workspacePath);
  }, [workspacePath]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const layout = useMemo(() => computeGraph(commits ?? []), [commits]);
  const gutter = Math.max(28, layout.laneCount * LANE_W + PAD * 2);
  const height = layout.rows.length * ROW_H;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyTitle")}
        className="flex h-[min(82vh,760px)] w-[min(940px,94vw)] flex-col overflow-hidden rounded-xl border border-separator-border bg-background-primary-default shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-separator-border px-4 py-3">
          <span className="shrink-0 text-body-medium text-text-primary">
            {t("git.historyTitle")}
          </span>
          <span className="min-w-0 truncate text-caption-1-regular text-text-tertiary">
            {workspacePath}
          </span>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            leadingIcon={X}
            aria-label={t("common.close")}
            onClick={onClose}
            className="ml-auto shrink-0"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {layout.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-2-regular text-text-tertiary">
              {t("git.noCommits")}
            </p>
          ) : (
            <div className="relative" style={{ minHeight: height }}>
              <svg
                className="pointer-events-none absolute left-0 top-0"
                width={gutter}
                height={height}
                viewBox={`0 0 ${gutter} ${height}`}
                aria-hidden
              >
                {layout.edges.map((edge, index) => {
                  const x1 = PAD + edge.fromLane * LANE_W;
                  const y1 = edge.fromRow * ROW_H + ROW_H / 2;
                  const x2 = PAD + edge.toLane * LANE_W;
                  const y2 = edge.toRow * ROW_H + ROW_H / 2;
                  const dy = y2 - y1;
                  return (
                    <path
                      key={index}
                      d={`M ${x1} ${y1} C ${x1} ${y1 + dy * 0.45}, ${x2} ${y2 - dy * 0.45}, ${x2} ${y2}`}
                      fill="none"
                      stroke={laneColor(edge.lane)}
                      strokeWidth={2}
                      strokeOpacity={0.7}
                    />
                  );
                })}
                {layout.rows.map((row, index) => {
                  const cx = PAD + row.lane * LANE_W;
                  const cy = index * ROW_H + ROW_H / 2;
                  return (
                    <g key={row.commit.id}>
                      {row.commit.isHead && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={DOT_R + 3}
                          fill={laneColor(row.lane)}
                          fillOpacity={0.18}
                        />
                      )}
                      <circle cx={cx} cy={cy} r={DOT_R} fill={laneColor(row.lane)} />
                    </g>
                  );
                })}
              </svg>

              {layout.rows.map((row) => (
                <div
                  key={row.commit.id}
                  className="flex items-center gap-3 pr-4"
                  style={{ height: ROW_H, paddingLeft: gutter }}
                >
                  <span className="w-16 shrink-0 font-mono text-caption-1-regular text-text-tertiary">
                    {row.commit.shortId}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {row.commit.refs.map((ref) => (
                      <span
                        key={ref}
                        className="shrink-0 rounded bg-status-blue-background/40 px-1.5 py-0.5 text-caption-2-medium text-status-blue-text"
                        title={ref}
                      >
                        {ref}
                      </span>
                    ))}
                    <span className="truncate text-body-2-regular text-text-primary">
                      {row.commit.summary}
                    </span>
                  </div>
                  <span className="hidden shrink-0 text-caption-1-regular text-text-tertiary sm:block">
                    {row.commit.author}
                  </span>
                  <span className="w-24 shrink-0 text-right text-caption-1-regular text-text-tertiary">
                    {relativeTime(row.commit.time * 1000)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
