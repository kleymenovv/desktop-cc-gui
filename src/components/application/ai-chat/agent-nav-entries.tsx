import { type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import Users from "lucide-react/dist/esm/icons/users";
import SquareKanban from "lucide-react/dist/esm/icons/square-kanban";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Check from "lucide-react/dist/esm/icons/check";
import Unplug from "lucide-react/dist/esm/icons/unplug";
import { useChatStore } from "@/features/chat/store";
import { activityCounts } from "@/features/agent-board/derive";
import { useAgentBoardStore, type AgentBoardFilter } from "@/features/agent-board/store";
import { usePaperclipStore, type TeamView } from "@/features/paperclip/store";
import { useSidebarStatus } from "@/features/paperclip/use-sidebar-status";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
type Marker = { kind: "running" | "waiting" | "error" | "done" | "offline"; count: number; label: string; onClick: () => void };
const icons = { running: CircleDot, waiting: CircleHelp, error: CircleAlert, done: Check, offline: Unplug };
const colors = {
  running: "text-blue-600 dark:text-blue-400",
  waiting: "text-amber-700 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  done: "text-emerald-700 dark:text-emerald-400",
  offline: "text-text-tertiary",
};

function ActivityNavItem({ icon: Icon, label, onOpen, markers }: { icon: Icon; label: string; onOpen: () => void; markers: Marker[] }) {
  return <div className="flex w-full min-w-0 items-center gap-0.5 rounded-2lg hover:bg-background-secondary-hover">
    <button type="button" onClick={onOpen} aria-label={label} title={label}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-2lg p-2 text-left">
      <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      <span className="truncate text-body-2-medium text-text-secondary">{label}</span>
    </button>
    {markers.filter((marker) => marker.count > 0).map((marker) => {
      const StatusIcon = icons[marker.kind];
      return <button key={marker.kind} type="button" title={marker.label} aria-label={`${label}: ${marker.label}`}
        onClick={marker.onClick}
        className={`flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-1 text-caption-2-medium hover:bg-background-tertiary-default ${colors[marker.kind]}`}>
        <StatusIcon className="size-3" aria-hidden />
        {marker.kind !== "offline" && <span>{marker.count > 99 ? "99+" : marker.count}</span>}
      </button>;
    })}
  </div>;
}

export function AgentBoardNavEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const counts = useChatStore(useShallow(activityCounts));
  const open = (filter: AgentBoardFilter) => {
    onOpen();
    useAgentBoardStore.setState({ filter, search: "", project: "", selectedKey: null });
  };
  const markers = (["running", "waiting", "error", "done"] as const).map((kind) => ({
    kind, count: counts[kind], label: t(`agentNav.${kind}`, { count: counts[kind] }), onClick: () => open(kind),
  }));
  return <ActivityNavItem icon={SquareKanban} label={t("agentBoard.title")} onOpen={onOpen} markers={markers} />;
}

export function PaperclipNavEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  useSidebarStatus();
  const { dashboard, statusError, error, connected, updatedAt, companyId } = usePaperclipStore(useShallow((s) => ({
    dashboard: s.dashboard, statusError: s.statusError, error: s.error, connected: s.connected,
    updatedAt: s.statusUpdatedAt, companyId: s.companyId,
  })));
  const open = (view: TeamView) => {
    onOpen();
    usePaperclipStore.setState({ view, search: "", projectId: "", selectedIssueId: null });
  };
  const markers: Marker[] = [];
  if (statusError || (!connected && error)) {
    markers.push({ kind: "offline", count: 1, label: t("agentNav.offline"), onClick: () => open("settings") });
  } else if (dashboard && updatedAt && connected && companyId) {
    const running = dashboard.agents.running;
    const approvals = dashboard.pendingApprovals;
    const blocked = dashboard.tasks.blocked;
    const errors = dashboard.agents.error;
    markers.push(
      { kind: "running", count: running, label: t("agentNav.running", { count: running }), onClick: () => open("agents") },
      { kind: "waiting", count: approvals + blocked,
        label: t("agentNav.teamAttention", { approvals, blocked }), onClick: () => open(approvals > 0 ? "approvals" : "tasks") },
      { kind: "error", count: errors, label: t("agentNav.error", { count: errors }), onClick: () => open("agents") },
    );
  }
  return <ActivityNavItem icon={Users} label={t("paperclip.title")} onOpen={onOpen} markers={markers} />;
}
