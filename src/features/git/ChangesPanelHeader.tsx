import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import CloudDownload from "lucide-react/dist/esm/icons/cloud-download";
import Download from "lucide-react/dist/esm/icons/download";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import CloudUpload from "lucide-react/dist/esm/icons/cloud-upload";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import List from "lucide-react/dist/esm/icons/list";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import {
  Dropdown,
  DropdownDivider,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { type BranchInfo } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { GitHistoryDialog } from "./GitHistoryDialog";
import { useGitStore } from "./store";

interface ChangesPanelHeaderProps {
  workspacePath: string;
  /** Set when the panel follows the file tree's selection into a repository
   *  other than the workspace root: rendered as a badge so the user can see
   *  which repo stage/commit/pull/push will act on. */
  followedRepoPath?: string;
  notRepo: boolean;
  branch: string | undefined;
  /** Commits ahead of / behind the upstream; undefined hides the indicator. */
  ahead: number | undefined;
  behind: number | undefined;
  branches: BranchInfo[] | undefined;
  pending: Record<string, true>;
  /** First error to surface: a failed action, else the last refresh failure. */
  error: string | null;
  run: (key: string, action: () => Promise<unknown>) => void;
  onDismissError: () => void;
  viewMode?: "flat" | "tree";
  onToggleViewMode?: () => void;
}

/** Title row with refresh/pull/push, the branch picker, and the new-branch form. */
export function ChangesPanelHeader({
  workspacePath,
  followedRepoPath,
  notRepo,
  branch,
  ahead,
  behind,
  branches,
  pending,
  error,
  run,
  onDismissError,
  viewMode,
  onToggleViewMode,
}: ChangesPanelHeaderProps) {
  const { t } = useTranslation();
  const [branchOpen, setBranchOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Spin → check → idle click feedback for refresh/fetch; check flash only for
  // pull/push (a spinning cloud reads as a glitch, not progress).
  const refreshAction = useActionFeedback({ spin: true });
  const fetchAction = useActionFeedback({ spin: true });
  const pullAction = useActionFeedback();
  const pushAction = useActionFeedback();

  const handleRefresh = () => {
    if (refreshAction.feedback === "running") return;
    run("refresh", () =>
      // refresh() reports failure through store state instead of throwing.
      refreshAction.start(
        () => useGitStore.getState().refresh(workspacePath, true),
        () => {
          const state = useGitStore.getState();
          return (
            state.errorByWorkspace[workspacePath] != null ||
            state.notRepoByWorkspace[workspacePath] === true
          );
        },
      ),
    );
  };

  const handleFetch = () => {
    if (fetchAction.feedback === "running") return;
    run("fetch", () => fetchAction.start(() => useGitStore.getState().fetch(workspacePath)));
  };

  // Pull the current upstream when no source is given; otherwise the chosen
  // remote branch (the picker lets the user pull from any fetched branch).
  const handlePull = (remote?: string, branchName?: string) => {
    run("pull", () =>
      pullAction.start(() => {
        const store = useGitStore.getState();
        return remote && branchName
          ? store.pullFrom(workspacePath, remote, branchName)
          : store.pull(workspacePath);
      }),
    );
  };

  const currentUpstream = useMemo(
    () => (branches ?? []).find((b) => !b.isRemote && b.name === branch)?.upstream,
    [branches, branch],
  );
  const pullSources = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ remote: string; branch: string; label: string }> = [];
    for (const b of branches ?? []) {
      if (!b.isRemote) continue;
      const slash = b.name.indexOf("/");
      if (slash <= 0 || slash === b.name.length - 1) continue;
      const key = b.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        remote: b.name.slice(0, slash),
        branch: b.name.slice(slash + 1),
        label: b.name,
      });
    }
    return out;
  }, [branches]);

  return (
    <div className="flex flex-col gap-2 border-b border-separator-border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-body-medium text-text-primary">{t("git.changes")}</span>
        {followedRepoPath && (
          <span
            className="max-w-32 truncate rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary"
            title={followedRepoPath}
          >
            {followedRepoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? followedRepoPath}
          </span>
        )}
        {ahead !== undefined && behind !== undefined && (
          <span className="text-xs text-text-tertiary">
            ↑{ahead} ↓{behind}
          </span>
        )}
        <HeaderActions
          notRepo={notRepo}
          pending={pending}
          viewMode={viewMode}
          onToggleViewMode={onToggleViewMode}
          refreshFeedback={refreshAction.feedback}
          fetchFeedback={fetchAction.feedback}
          pullFeedback={pullAction.feedback}
          pushFeedback={pushAction.feedback}
          onRefresh={handleRefresh}
          onFetch={handleFetch}
          onPull={handlePull}
          onPush={() =>
            run("push", () =>
              pushAction.start(() => useGitStore.getState().push(workspacePath)),
            )
          }
          onOpenHistory={() => setHistoryOpen(true)}
          pullSources={pullSources}
          upstream={currentUpstream}
        />
      </div>
      {!notRepo && (
        <BranchPicker
          workspacePath={workspacePath}
          branch={branch}
          branches={branches}
          run={run}
          open={branchOpen}
          onOpenChange={setBranchOpen}
          query={branchQuery}
          onQueryChange={setBranchQuery}
          onCreateBranch={() => {
            setBranchOpen(false);
            setCreatingBranch(true);
          }}
        />
      )}
      {creatingBranch && (
        <NewBranchForm
          name={newBranchName}
          busy={pending.createBranch === true}
          onNameChange={setNewBranchName}
          onSubmit={(name) =>
            run("createBranch", async () => {
              await useGitStore.getState().createBranch(workspacePath, name);
              setCreatingBranch(false);
              setNewBranchName("");
            })
          }
          onCancel={() => {
            setCreatingBranch(false);
            setNewBranchName("");
          }}
        />
      )}
      {error && <HeaderError message={error} onDismiss={onDismissError} />}
      {historyOpen && (
        <GitHistoryDialog workspacePath={workspacePath} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

/** Refresh / pull / push plus the flat–tree toggle, pinned to the right. */
const ICON_ACTION_CLASS = cx(
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
  "text-foreground-icon-secondary outline-none transition-colors",
  "hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

function HeaderActions({
  notRepo,
  pending,
  viewMode,
  onToggleViewMode,
  refreshFeedback,
  fetchFeedback,
  pullFeedback,
  pushFeedback,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onOpenHistory,
  pullSources,
  upstream,
}: {
  notRepo: boolean;
  pending: Record<string, true>;
  viewMode?: "flat" | "tree";
  onToggleViewMode?: () => void;
  refreshFeedback: ReturnType<typeof useActionFeedback>["feedback"];
  fetchFeedback: ReturnType<typeof useActionFeedback>["feedback"];
  pullFeedback: ReturnType<typeof useActionFeedback>["feedback"];
  pushFeedback: ReturnType<typeof useActionFeedback>["feedback"];
  onRefresh: () => void;
  onFetch: () => void;
  onPull: (remote?: string, branch?: string) => void;
  onPush: () => void;
  onOpenHistory: () => void;
  pullSources: Array<{ remote: string; branch: string; label: string }>;
  upstream: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex items-center gap-1">
      {onToggleViewMode && (
        <IconButton
          icon={viewMode === "tree" ? List : FolderTree}
          size="small"
          aria-label={viewMode === "tree" ? t("git.viewAsList") : t("git.viewAsTree")}
          title={viewMode === "tree" ? t("git.viewAsList") : t("git.viewAsTree")}
          onClick={onToggleViewMode}
        />
      )}
      <IconButton
        icon={RefreshCw}
        size="small"
        aria-label={t("common.refresh")}
        title={t("common.refresh")}
        disabled={pending.refresh === true}
        onClick={onRefresh}
      >
        <ActionFeedbackIcon icon={RefreshCw} feedback={refreshFeedback} spin />
      </IconButton>
      <IconButton
        icon={Download}
        size="small"
        aria-label={t("git.fetch")}
        title={t("git.fetch")}
        disabled={notRepo || pending.fetch === true}
        onClick={onFetch}
      >
        <ActionFeedbackIcon icon={Download} feedback={fetchFeedback} spin />
      </IconButton>
      {/* Pull is a menu: the current upstream is the default, but any fetched
          remote branch can be chosen as the source. */}
      <Dropdown>
        <DropdownTrigger
          aria-label={t("git.pull")}
          isDisabled={notRepo || pending.pull === true}
          className={ICON_ACTION_CLASS}
        >
          <ActionFeedbackIcon icon={CloudDownload} feedback={pullFeedback} />
        </DropdownTrigger>
        <DropdownPopover aria-label={t("git.pullFrom")} placement="bottom end" className="min-w-60">
          {upstream && (
            <DropdownItem
              className="px-2 py-1.5"
              onSelect={() => {
                const slash = upstream.indexOf("/");
                if (slash > 0) onPull(upstream.slice(0, slash), upstream.slice(slash + 1));
                else onPull();
              }}
            >
              <span className="truncate text-body-medium text-text-primary">
                {t("git.pullUpstream", { branch: upstream })}
              </span>
            </DropdownItem>
          )}
          {upstream && <DropdownDivider />}
          <DropdownGroup label={t("git.fromRemoteBranch")}>
            {pullSources.length === 0 ? (
              <span className="block px-2 py-1.5 text-body-medium text-text-tertiary">
                {t("git.noRemoteBranches")}
              </span>
            ) : (
              pullSources.map((source) => (
                <DropdownItem
                  key={source.label}
                  className="px-2 py-1.5"
                  onSelect={() => onPull(source.remote, source.branch)}
                >
                  <span className="truncate text-body-medium text-text-primary">
                    {source.label}
                  </span>
                </DropdownItem>
              ))
            )}
          </DropdownGroup>
        </DropdownPopover>
      </Dropdown>
      <IconButton
        icon={CloudUpload}
        size="small"
        aria-label={t("git.push")}
        title={t("git.push")}
        disabled={notRepo || pending.push === true}
        onClick={onPush}
      >
        <ActionFeedbackIcon icon={CloudUpload} feedback={pushFeedback} />
      </IconButton>
      <IconButton
        icon={GitCommitHorizontal}
        size="small"
        aria-label={t("git.history")}
        title={t("git.history")}
        disabled={notRepo}
        onClick={onOpenHistory}
      />
    </div>
  );
}

/** Upstream + last commit, shown as the row tooltip. */
function branchTooltip(b: BranchInfo): string {
  return [b.upstream ? `→ ${b.upstream}` : null, b.lastCommitSubject]
    .filter(Boolean)
    .join("\n");
}

/** ↓ behind / ↑ ahead badges: which branches can be updated or pushed. */
function BranchCounts({
  ahead,
  behind,
  className,
}: {
  ahead?: number;
  behind?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!(ahead ?? 0) && !(behind ?? 0)) return null;
  return (
    <span className={cx("flex shrink-0 items-center gap-1", className)}>
      {(behind ?? 0) > 0 && (
        <span
          className="rounded bg-status-yellow-background/40 px-1 text-caption-2-medium tabular-nums text-status-yellow-text"
          title={t("git.behindCount", { count: behind })}
        >
          ↓{behind}
        </span>
      )}
      {(ahead ?? 0) > 0 && (
        <span
          className="rounded bg-status-green-background/40 px-1 text-caption-2-medium tabular-nums text-status-green-text"
          title={t("git.aheadCount", { count: ahead })}
        >
          ↑{ahead}
        </span>
      )}
    </span>
  );
}

/** Branch trigger + searchable popover + the "new branch" entry. */
function BranchPicker({
  workspacePath,
  branch,
  branches,
  run,
  open,
  onOpenChange,
  query,
  onQueryChange,
  onCreateBranch,
}: {
  workspacePath: string;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  run: (key: string, action: () => Promise<unknown>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onCreateBranch: () => void;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);

  // Stale filter text must not survive into the next open.
  useEffect(() => {
    if (!open) onQueryChange("");
  }, [open, onQueryChange]);

  // Focus the filter as the popover opens (autoFocus would move focus on
  // load, which the a11y rules reject).
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const filteredBranches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (branches ?? []).filter(
      (b) =>
        (q.length === 0 || b.name.toLowerCase().includes(q)) ||
        (b.upstream?.toLowerCase().includes(q) ?? false),
    );
  }, [branches, query]);
  const localBranches = filteredBranches.filter((b) => !b.isRemote);
  const remoteBranches = filteredBranches.filter((b) => b.isRemote);

  return (
    <div className="flex items-center gap-1">
      <Dropdown
        isOpen={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          // The cached list goes stale when branches change outside the
          // app (CLI checkout/switch); reload on every open.
          if (next) void useGitStore.getState().loadBranches(workspacePath);
        }}
      >
        <DropdownTrigger
          className={cx(
            "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border-button-default",
            "px-2 text-body-medium text-text-primary shadow-xs",
            "hover:bg-background-secondary-hover",
          )}
        >
          <GitBranch
            aria-hidden
            className="size-4 shrink-0 text-foreground-icon-secondary"
          />
          <span className="truncate">{branch ?? "…"}</span>
          <ChevronDown
            aria-hidden
            className="ml-auto size-4 shrink-0 text-foreground-icon-tertiary"
          />
        </DropdownTrigger>
        <DropdownPopover aria-label={t("git.branch")} placement="bottom start" className="max-h-80!">
          {/* Single scroller: the popover itself, capped at 320px
              (react-aria's inline viewport clamp would otherwise let it
              grow to nearly full-window height, so the cap needs the
              important modifier to win). Search and the new-branch footer
              pin via sticky; the rows scroll between them. An inner
              max-h scroll div nested badly here — in short windows the
              clamped popover clipped the inner list and its scrollbar,
              leaving the lower branches unreachable. */}
          <div className="sticky -top-2.5 z-10 -mx-2.5 -mt-2.5 bg-background-primary-default px-2.5 pt-2.5 pb-1">
            <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border-button-default px-2">
              <Search
                aria-hidden
                className="size-4 shrink-0 text-foreground-icon-secondary"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder={t("git.searchBranches")}
                className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
              />
            </div>
          </div>
          {localBranches.length > 0 && (
            <DropdownGroup label={t("git.localBranches")}>
              {localBranches.map((b) => (
                <DropdownItem
                  key={b.name}
                  selected={b.name === branch}
                  className="px-2 py-1.5"
                  onSelect={() => {
                    onOpenChange(false);
                    // "Current" must come from the same source as the trigger
                    // label (status.branch): the cached list's isCurrent lags
                    // behind external checkouts and would no-op the click.
                    if (b.name !== branch) {
                      run("checkout", () =>
                        useGitStore.getState().checkout(workspacePath, b.name),
                      );
                    }
                  }}
                >
                  <span
                    className="min-w-0 truncate text-body-medium text-text-primary"
                    title={branchTooltip(b)}
                  >
                    {b.name}
                  </span>
                  <BranchCounts ahead={b.ahead} behind={b.behind} className="ml-auto" />
                </DropdownItem>
              ))}
            </DropdownGroup>
          )}
          {remoteBranches.length > 0 && (
            <DropdownGroup label={t("git.remoteBranches")}>
              {remoteBranches.map((b) => (
                <DropdownItem
                  key={b.name}
                  selected={b.name === branch}
                  className="px-2 py-1.5"
                  onSelect={() => {
                    onOpenChange(false);
                    if (b.name !== branch) {
                      run("checkout", () =>
                        useGitStore.getState().checkout(workspacePath, b.name),
                      );
                    }
                  }}
                >
                  <span
                    className="min-w-0 truncate text-body-medium text-text-primary"
                    title={branchTooltip(b)}
                  >
                    {b.name}
                  </span>
                  <span className="ml-auto shrink-0 rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary">
                    {t("git.remoteBranch")}
                  </span>
                </DropdownItem>
              ))}
            </DropdownGroup>
          )}
          {filteredBranches.length === 0 && (
            <span className="px-2 py-1.5 text-body-medium text-text-tertiary">
              {t("git.noMatchingBranches")}
            </span>
          )}
          <div className="sticky -bottom-2.5 z-10 -mx-2.5 -mb-2.5 bg-background-primary-default px-2.5 pb-2.5">
            <DropdownDivider />
            <DropdownItem className="px-2 py-1.5" onSelect={onCreateBranch}>
              <Plus aria-hidden className="size-4 text-foreground-icon-secondary" />
              <span className="text-body-medium text-text-primary">
                {t("git.newBranch")}
              </span>
            </DropdownItem>
          </div>
        </DropdownPopover>
      </Dropdown>
    </div>
  );
}

/** Inline new-branch form under the header. */
function NewBranchForm({
  name,
  busy,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the name field as the form appears (autoFocus would move focus on
  // load, which the a11y rules reject).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed.length === 0 || busy) return;
        onSubmit(trimmed);
      }}
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t("git.branchNamePlaceholder")}
        className={cx(
          "h-8 min-w-0 flex-1 rounded-lg border border-border-button-default px-2",
          "text-body-medium text-text-primary placeholder:text-text-placeholder",
          "outline-none focus:border-border-focus-ring",
        )}
      />
      <Button size="small" type="submit" disabled={name.trim().length === 0 || busy}>
        {t("common.confirm")}
      </Button>
      <Button size="small" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}

/** Inline dismissible error line under the header. */
function HeaderError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex items-center gap-2">
      <p className="min-w-0 flex-1 break-words text-xs text-text-error-primary">{message}</p>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onDismiss}
        className="shrink-0 cursor-pointer rounded p-0.5 text-text-error-primary hover:bg-background-tertiary-hover"
      >
        ×
      </button>
    </div>
  );
}
