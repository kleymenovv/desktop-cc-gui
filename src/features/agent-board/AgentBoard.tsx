import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import Check from "lucide-react/dist/esm/icons/check";
import Circle from "lucide-react/dist/esm/icons/circle";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Hand from "lucide-react/dist/esm/icons/hand";
import X from "lucide-react/dist/esm/icons/x";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { Button } from "@/components/base/buttons/button";
import { Kbd } from "@/components/base/kbd";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ChatConversation } from "@/features/chat/components/ChatConversation";
import { useChatStore } from "@/features/chat/store";
import { sessionKey, type ActiveSession } from "@/features/chat/store/persistence";
import type { SessionState } from "@/features/chat/store/stream";
import { relativeTime } from "@/features/chat/time";
import { useGitStore } from "@/features/git/store";
import { formatShortcutForPlatform } from "@/features/shortcuts/shortcuts";
import { useShortcutsStore } from "@/features/shortcuts/store";
import {
  worktreeMetaOf,
  type EngineInfo,
  type SessionMeta,
  type TodoItem,
  type Workspace,
} from "@/lib/ipc";
import i18n from "@/lib/i18n";
import { cx } from "@/utils/cx";
import { focusAgentSession, focusNextWaitingAgent } from "./actions";
import {
  agentStatus,
  digestSession,
  type AgentSessionDigest,
  type AgentStatus,
} from "./derive";
import { useAgentBoardStore, type AgentBoardFilter } from "./store";

/**
 * Agent board: every open session tab as a card, grouped by what it needs
 * from the user. Answers "what is each agent doing, and why" without opening
 * the tabs one by one. Read-only over the chat store except for the inline
 * permission answer and stop, which call the same store actions as the chat.
 */

interface AgentCard {
  key: string;
  tab: ActiveSession;
  status: AgentStatus;
  title: string;
  digest: AgentSessionDigest | null;
  session: SessionState | undefined;
  workspaceName: string;
  branch: string | null;
  updatedAt: number | null;
  error: string | null;
  retrying: boolean;
}

type Column = "waiting" | "running" | "done" | "error";

const COLUMNS: Column[] = ["waiting", "running", "done", "error"];

/** Idle sessions share the done column: both are "nothing to do right now". */
function columnOf(status: AgentStatus): Column {
  return status === "idle" ? "done" : status;
}

const COLUMN_DOT: Record<Column, string> = {
  waiting: "bg-status-yellow-text",
  running: "bg-status-green-text",
  done: "bg-status-blue-text",
  error: "bg-status-rose-text",
};

const DETAIL_WIDTH_KEY = "ccgui-next.agent-board.detail-width:v1";
const DETAIL_WIDTH_DEFAULT = 520;
const DETAIL_WIDTH_MIN = 360;

function initialDetailWidth(): number {
  const stored = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= DETAIL_WIDTH_MIN ? stored : DETAIL_WIDTH_DEFAULT;
}

/** Keep the chat panel usable while leaving the kanban some room. */
function clampDetailWidth(width: number): number {
  const max = Math.max(DETAIL_WIDTH_MIN, Math.round(window.innerWidth * 0.72));
  return Math.min(max, Math.max(DETAIL_WIDTH_MIN, Math.round(width)));
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Ticks once a second while some agent is running, so elapsed times move. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function useAgentCards(): AgentCard[] {
  const { t } = useTranslation();
  const { openTabs, bySession, sessions, workspaces, streamingByKey, retryingByKey, unseen } =
    useChatStore(
      useShallow((s) => ({
        openTabs: s.openTabs,
        bySession: s.bySession,
        sessions: s.sessions,
        workspaces: s.workspaces,
        streamingByKey: s.streamingByKey,
        retryingByKey: s.retryingByKey,
        unseen: s.unseen,
      })),
    );
  const statusByWorkspace = useGitStore((s) => s.statusByWorkspace);
  const metaByKey = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const meta of sessions) map.set(sessionKey(meta.engine, meta.sessionId, meta.workspacePath), meta);
    return map;
  }, [sessions]);
  const workspaceByPath = useMemo(() => {
    const map = new Map<string, Workspace>();
    for (const workspace of workspaces) map.set(workspace.path, workspace);
    return map;
  }, [workspaces]);

  return useMemo(
    () =>
      openTabs.map((tab) => {
        const key = sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
        const session = bySession[key];
        const meta = metaByKey.get(key);
        const digest = session && session.messages.length > 0 ? digestSession(session.messages) : null;
        const workspace = workspaceByPath.get(tab.workspacePath);
        const branch =
          (workspace && worktreeMetaOf(workspace)?.branch) ??
          statusByWorkspace[tab.workspacePath]?.branch ??
          null;
        return {
          key,
          tab,
          status: agentStatus({
            session,
            digest,
            streaming: streamingByKey[key] === true,
            retrying: retryingByKey[key] === true,
            unseen: unseen[key] === true,
          }),
          title:
            meta?.customTitle?.trim() ||
            meta?.title?.trim() ||
            digest?.task ||
            t("chat.newSession"),
          digest,
          session,
          workspaceName: workspace?.name || basename(tab.workspacePath),
          branch,
          updatedAt: meta?.updatedAt ?? null,
          error: session?.error ?? null,
          retrying: retryingByKey[key] === true,
        };
      }),
    [openTabs, bySession, metaByKey, workspaceByPath, statusByWorkspace, streamingByKey, retryingByKey, unseen, t],
  );
}

export function AgentBoard({
  engines,
  workspaces,
  startNewChat,
}: {
  engines: EngineInfo[];
  workspaces: Workspace[];
  startNewChat: (workspacePath: string) => void;
}) {
  const { t } = useTranslation();
  const cards = useAgentCards();
  const { filter, search, selectedKey, setFilter, setSearch, select } = useAgentBoardStore(
    useShallow((s) => ({
      filter: s.filter,
      search: s.search,
      selectedKey: s.selectedKey,
      setFilter: s.setFilter,
      setSearch: s.setSearch,
      select: s.select,
    })),
  );
  const nextShortcut = useShortcutsStore((s) => s.values.nextWaitingAgentShortcut);
  const now = useNow(cards.some((card) => card.status === "running"));
  const [detailWidth, setDetailWidth] = useState(initialDetailWidth);

  // Persist after the drag settles instead of on every pointermove.
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
    }, 200);
    return () => window.clearTimeout(id);
  }, [detailWidth]);

  const counts = useMemo(() => {
    const result: Record<Column, number> = { waiting: 0, running: 0, done: 0, error: 0 };
    for (const card of cards) result[columnOf(card.status)]++;
    return result;
  }, [cards]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter((card) =>
      [card.title, card.digest?.task, card.workspaceName, card.branch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [cards, search]);

  const columns = filter === "all" ? COLUMNS : COLUMNS.filter((column) => column === filter);
  const selected = cards.find((card) => card.key === selectedKey) ?? null;
  const filters: Array<{ id: AgentBoardFilter; label: string; count: number }> = [
    { id: "all", label: t("agentBoard.filterAll"), count: cards.length },
    { id: "waiting", label: t("agentBoard.colWaiting"), count: counts.waiting },
    { id: "running", label: t("agentBoard.colRunning"), count: counts.running },
    { id: "done", label: t("agentBoard.colDone"), count: counts.done },
    { id: "error", label: t("agentBoard.colError"), count: counts.error },
  ];
  const shortcutLabel = nextShortcut ? formatShortcutForPlatform(nextShortcut) : null;

  return (
    <div className="flex h-full min-h-0 bg-background-secondary-default/20">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h1 className="text-title-2-medium text-text-primary">{t("agentBoard.title")}</h1>
            <p className="mt-1 text-body-2-regular text-text-tertiary">{t("agentBoard.subtitle")}</p>
          </div>
          <Button
            size="small"
            variant="secondary"
            leadingIcon={Hand}
            disabled={counts.waiting === 0}
            onClick={() => focusNextWaitingAgent()}
          >
            {t("agentBoard.nextWaiting")}
            {shortcutLabel && <Kbd className="ml-1.5">{shortcutLabel}</Kbd>}
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-6 pt-5">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cx(
                "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-caption-1-medium transition-colors",
                filter === item.id
                  ? "border-status-blue-text/40 bg-status-blue-background/30 text-status-blue-text"
                  : "border-transparent text-text-tertiary hover:text-text-secondary",
              )}
            >
              {item.id !== "all" && (
                <span className={cx("size-1.5 rounded-full", COLUMN_DOT[item.id as Column])} />
              )}
              {item.label}
              <span className="tabular-nums opacity-70">{item.count}</span>
            </button>
          ))}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("agentBoard.searchPlaceholder")}
            aria-label={t("agentBoard.searchPlaceholder")}
            className="ml-auto min-w-[200px] rounded-md border border-border-button-default bg-background-primary-default px-3 py-1.5 text-body-2-regular text-text-primary outline-none placeholder:text-text-placeholder focus:border-status-blue-text/60"
          />
        </div>

        {cards.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-10 text-center text-body-2-regular text-text-tertiary">
            {t("agentBoard.empty")}
          </div>
        ) : (
          <div
            className={cx(
              "grid min-h-0 flex-1 auto-rows-min gap-4 overflow-auto px-6 pb-6 pt-4",
              filter === "all" ? "grid-cols-[repeat(auto-fit,minmax(260px,1fr))]" : "grid-cols-[minmax(260px,560px)]",
            )}
          >
            {columns.map((column) => {
              const items = visible.filter((card) => columnOf(card.status) === column);
              return (
                <section key={column} className="flex min-w-0 flex-col gap-2.5">
                  <h2 className="flex items-center gap-2 px-0.5 text-caption-1-medium uppercase tracking-wider text-text-tertiary">
                    <span className={cx("size-2 rounded-full", COLUMN_DOT[column])} />
                    {t(`agentBoard.col${column[0].toUpperCase()}${column.slice(1)}`)}
                    <span className="tabular-nums">{items.length}</span>
                  </h2>
                  {items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-separator-border px-3 py-6 text-center text-caption-1-regular text-text-tertiary">
                      {search.trim() ? t("agentBoard.emptyFilter") : "—"}
                    </div>
                  )}
                  {items.map((card) => (
                    <AgentCardView
                      key={card.key}
                      card={card}
                      now={now}
                      selected={card.key === selectedKey}
                      onSelect={() => select(card.key === selectedKey ? null : card.key)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {selected && (
        <AgentDetail
          card={selected}
          now={now}
          onClose={() => select(null)}
          engines={engines}
          workspaces={workspaces}
          startNewChat={startNewChat}
          width={detailWidth}
          onResize={(next) => setDetailWidth(clampDetailWidth(next))}
        />
      )}
    </div>
  );
}

/** Running: time since the turn started; otherwise when the session last
 *  changed (same compact units as the sidebar). */
function elapsedLabel(card: AgentCard, now: number): string {
  const started = card.session?.turnStartedAt;
  if (card.status === "running" && started) {
    const minutes = Math.floor((now - started) / 60_000);
    return minutes < 1 ? i18n.t("time.now") : i18n.t("time.minutes", { count: minutes });
  }
  return relativeTime(card.updatedAt);
}

function AgentCardView({
  card,
  now,
  selected,
  onSelect,
}: {
  card: AgentCard;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const digest = card.digest;
  const showTask = digest?.task && digest.task !== card.title;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={() => focusAgentSession(card.tab)}
      onKeyDown={(event) => {
        if (event.key === "Enter") focusAgentSession(card.tab);
        if (event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cx(
        "group flex cursor-pointer flex-col gap-2 rounded-xl border bg-background-primary-default p-3 text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        selected
          ? "border-status-blue-text/60"
          : "border-border-button-default hover:border-border-button-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-caption-1-regular text-text-tertiary">
        <EngineIcon engine={card.tab.engine} size={14} className="shrink-0" />
        <span className="truncate">{card.workspaceName}</span>
        {card.branch && (
          <span className="max-w-[45%] truncate rounded bg-background-secondary-default px-1.5 font-mono text-[11px] text-text-secondary">
            {card.branch}
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums">{elapsedLabel(card, now)}</span>
      </div>

      <div className="flex items-start gap-1.5">
        <span className="line-clamp-2 text-body-2-medium text-text-primary">{card.title}</span>
        {card.status === "done" && (
          <span className="mt-0.5 shrink-0 rounded-full bg-status-blue-background/40 px-1.5 text-caption-2-medium text-status-blue-text">
            {t("agentBoard.unseen")}
          </span>
        )}
      </div>
      {showTask && (
        <p className="line-clamp-2 text-caption-1-regular text-text-tertiary">{digest.task}</p>
      )}

      <CardState card={card} />

      {digest && digest.todos.length > 0 && <TodoProgress digest={digest} />}

      {digest && digest.editedFiles.length > 0 && (
        <div className="text-caption-1-regular text-text-tertiary">
          {t("chat.editedFiles", { count: digest.editedFiles.length })}
        </div>
      )}
    </div>
  );
}

/** The one line that says what the card needs: the ask, the live activity,
 *  or the error. Done/idle cards show nothing here. */
function CardState({ card }: { card: AgentCard }) {
  const { t } = useTranslation();
  const ask = card.digest?.ask;
  if (card.status === "waiting" && ask) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-status-yellow-text/30 bg-status-yellow-background/30 px-2.5 py-2">
        <div className="text-caption-1-medium text-status-yellow-text">
          {ask.kind === "grant"
            ? t("agentBoard.askGrant")
            : ask.kind === "question"
              ? t("agentBoard.askQuestion")
              : t("agentBoard.askPlan")}
        </div>
        {ask.kind === "grant" && (
          <div className="line-clamp-2 break-all font-mono text-[11px] text-text-secondary">
            {ask.path ?? ask.text}
          </div>
        )}
        {ask.kind === "question" && (
          <div className="line-clamp-3 text-caption-1-regular text-text-secondary">{ask.text}</div>
        )}
        <div className="flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
          {ask.kind === "grant" ? (
            <>
              <Button
                size="xs"
                variant="primary"
                className="px-2"
                onClick={() => void useChatStore.getState().respondToGrant(card.key, ask.seq, true)}
              >
                {t("agentBoard.allow")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="px-2"
                onClick={() => void useChatStore.getState().respondToGrant(card.key, ask.seq, false)}
              >
                {t("agentBoard.deny")}
              </Button>
            </>
          ) : (
            <Button size="xs" variant="primary" className="px-2" onClick={() => focusAgentSession(card.tab)}>
              {ask.kind === "question" ? t("agentBoard.answer") : t("agentBoard.reviewPlan")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (card.status === "running") {
    const activity = card.digest?.activity;
    const label = card.retrying
      ? t("agentBoard.retrying")
      : activity?.kind === "tool"
        ? activity.tool
        : activity?.kind === "writing"
          ? t("agentBoard.writing")
          : t("agentBoard.thinking");
    const detail = !card.retrying && activity?.kind === "tool" ? activity.detail : null;
    return (
      <div className="flex min-w-0 items-start gap-2 rounded-lg bg-background-secondary-default px-2.5 py-2">
        <span className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-status-green-text" />
        <div className="min-w-0 text-caption-1-regular">
          <span className="text-text-primary">{label}</span>
          {detail && (
            <div className="truncate font-mono text-[11px] text-text-tertiary" title={detail}>
              {detail}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (card.status === "error" && card.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-status-rose-text/30 bg-status-rose-background/30 px-2.5 py-2 text-caption-1-regular text-status-rose-text">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="line-clamp-3">{card.error}</span>
      </div>
    );
  }
  return null;
}

function TodoProgress({ digest }: { digest: AgentSessionDigest }) {
  const total = digest.todos.length;
  const ratio = total > 0 ? digest.todoDone / total : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-background-tertiary-default">
          <div
            className="h-full rounded-full bg-status-blue-text transition-[width] duration-300"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <span className="text-caption-2-medium tabular-nums text-text-tertiary">
          {digest.todoDone}/{total}
        </span>
      </div>
      {digest.todoCurrent && (
        <div className="truncate text-caption-1-regular text-text-secondary">→ {digest.todoCurrent}</div>
      )}
    </div>
  );
}

function TodoIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "complete") return <Check className="mt-0.5 size-3.5 shrink-0 text-status-green-text" aria-hidden />;
  if (status === "active") return <CircleDot className="mt-0.5 size-3.5 shrink-0 text-status-blue-text" aria-hidden />;
  if (status === "blocked") return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-status-rose-text" aria-hidden />;
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden />;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption-1-medium uppercase tracking-wider text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function DetailTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "cursor-pointer rounded-md px-2.5 py-1 text-caption-1-medium transition-colors",
        active
          ? "bg-background-secondary-default text-text-primary"
          : "text-text-tertiary hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

function AgentDetail({
  card,
  now,
  onClose,
  engines,
  workspaces,
  startNewChat,
  width,
  onResize,
}: {
  card: AgentCard;
  now: number;
  onClose: () => void;
  engines: EngineInfo[];
  workspaces: Workspace[];
  startNewChat: (workspacePath: string) => void;
  width: number;
  onResize: (width: number) => void;
}) {
  const { t } = useTranslation();
  const digest = card.digest;
  const [view, setView] = useState<"chat" | "details">("chat");
  const [resizing, setResizing] = useState(false);
  const composerRef = useRef<ComposerInputHandle | null>(null);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      onResize(startWidth - (moveEvent.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Selecting a card opens that session: keep the global active tab in sync
  // so the composer menus (engine/model/channel) resolve this session rather
  // than whichever tab was in view before the board opened. Sends already
  // target `card.tab`; this only fixes the displayed prefs.
  useEffect(() => {
    const store = useChatStore.getState();
    const active = store.active;
    const same =
      active !== null &&
      active.engine === card.tab.engine &&
      active.sessionId === card.tab.sessionId &&
      active.workspacePath === card.tab.workspacePath;
    if (!same) {
      store.focusTab(card.tab.engine, card.tab.sessionId, card.tab.workspacePath);
    }
  }, [card.key, card.tab.engine, card.tab.sessionId, card.tab.workspacePath]);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-separator-border bg-background-primary-default"
      style={{ width, maxWidth: "72%" }}
    >
      {/* Drag the left edge to widen/narrow the chat; double-click resets. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("agentBoard.resizePanel")}
        title={t("agentBoard.resizePanel")}
        onPointerDown={startResize}
        onDoubleClick={() => onResize(DETAIL_WIDTH_DEFAULT)}
        className={cx(
          "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none",
          resizing ? "bg-status-blue-text/40" : "hover:bg-status-blue-text/30",
        )}
      />
      <div className="flex items-start gap-2 border-b border-separator-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-caption-1-regular text-text-tertiary">
            <EngineIcon engine={card.tab.engine} size={14} className="shrink-0" />
            <span className="truncate">{card.workspaceName}</span>
            {card.branch && <span className="truncate font-mono text-[11px]">· {card.branch}</span>}
            <span className="ml-auto shrink-0 tabular-nums">{elapsedLabel(card, now)}</span>
          </div>
          <div className="mt-1 text-body-2-medium text-text-primary">{card.title}</div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          leadingIcon={ExternalLink}
          aria-label={t("agentBoard.openSession")}
          onClick={() => focusAgentSession(card.tab)}
        />
        <Button size="xs" variant="ghost" iconOnly leadingIcon={X} aria-label={t("agentBoard.close")} onClick={onClose} />
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-separator-border px-3 py-1.5">
        <DetailTab active={view === "chat"} onClick={() => setView("chat")}>
          {t("agentBoard.chat")}
        </DetailTab>
        <DetailTab active={view === "details"} onClick={() => setView("details")}>
          {t("agentBoard.details")}
        </DetailTab>
        {card.status === "running" && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto px-2"
            onClick={() => void useChatStore.getState().interrupt(card.tab)}
          >
            {t("agentBoard.stop")}
          </Button>
        )}
      </div>

      {view === "chat" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatConversation
            active={card.tab}
            engines={engines}
            workspaces={workspaces}
            startNewChat={startNewChat}
            composerInputRef={composerRef}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4">
          <DetailSection title={t("agentBoard.task")}>
            <p className="whitespace-pre-wrap rounded-lg bg-background-secondary-default px-3 py-2 text-body-2-regular text-text-secondary">
              {digest?.task ?? t("agentBoard.noTask")}
            </p>
          </DetailSection>

          <CardState card={card} />

          {digest && digest.todos.length > 0 && (
            <DetailSection title={`${t("agentBoard.plan")} · ${digest.todoDone}/${digest.todos.length}`}>
              <ul className="flex flex-col gap-1.5">
                {digest.todos.map((item, index) => (
                  <li key={item.id ?? `${index}:${item.content}`} className="flex items-start gap-2 text-body-2-regular">
                    <TodoIcon status={item.status} />
                    <span
                      className={cx(
                        item.status === "complete" && "text-text-tertiary line-through",
                        item.status === "active" && "text-text-primary",
                        item.status !== "complete" && item.status !== "active" && "text-text-secondary",
                      )}
                    >
                      {item.content}
                    </span>
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          <DetailSection title={t("agentBoard.timeline")}>
            {digest && digest.timeline.length > 0 ? (
              <ol className="flex flex-col gap-1.5 border-l border-separator-border pl-3">
                {digest.timeline.map((entry) => (
                  <li key={entry.seq} className="min-w-0 text-caption-1-regular">
                    <span className="text-text-primary">{entry.tool}</span>
                    {entry.detail && (
                      <div className="truncate font-mono text-[11px] text-text-tertiary" title={entry.detail}>
                        {entry.detail}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-caption-1-regular text-text-tertiary">{t("agentBoard.noTimeline")}</p>
            )}
          </DetailSection>

          {digest && digest.editedFiles.length > 0 && (
            <DetailSection title={`${t("agentBoard.files")} · ${digest.editedFiles.length}`}>
              <ul className="flex flex-col gap-1">
                {digest.editedFiles.map((path) => (
                  <li key={path} className="truncate font-mono text-[11px] text-text-secondary" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          {digest?.lastReply && (
            <DetailSection title={t("agentBoard.lastReply")}>
              <p className="line-clamp-[12] whitespace-pre-wrap text-body-2-regular text-text-secondary">
                {digest.lastReply}
              </p>
            </DetailSection>
          )}
        </div>
      )}
    </aside>
  );
}
