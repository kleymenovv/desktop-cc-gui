import type { GitCommit } from "@/lib/ipc";

/**
 * Layout for the history graph, computed from commit topology alone.
 *
 * The backend returns commits newest-first with their parent ids; this pass
 * assigns each commit a vertical lane so branch/merge structure is visible
 * without pulling in a graph library. Lanes are a best-effort heuristic:
 * the first parent always continues the child's lane, extra parents (merges)
 * take a free lane. It is stable and cheap, not a full "git log --graph"
 * port — which is what a "rough visualization" needs.
 */

export interface GraphRow {
  commit: GitCommit;
  lane: number;
}

export interface GraphEdge {
  /** Row index of the child (smaller) and the parent (larger). */
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  /** Colour lane: the child's lane, so each branch keeps its colour. */
  lane: number;
}

export interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  /** Highest lane index + 1 (at least 1). */
  laneCount: number;
}

/** Colour palette for lanes; index wraps. Kept here so the SVG and the dot
 *  marker share the exact same colours. */
export const LANE_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
  "#8b5cf6",
] as const;

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function computeGraph(commits: GitCommit[]): GraphLayout {
  const rowById = new Map<string, number>();
  commits.forEach((commit, index) => {
    if (!rowById.has(commit.id)) rowById.set(commit.id, index);
  });

  const active: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    let lane = active.indexOf(commit.id);
    if (lane === -1) {
      // A branch tip (or a commit the walk reached through a path we did not
      // predict yet) starts in the first free lane, else a new one.
      lane = active.indexOf(null);
      if (lane === -1) {
        lane = active.length;
        active.push(commit.id);
      } else {
        active[lane] = commit.id;
      }
    }
    const firstParent = commit.parents[0];
    active[lane] = firstParent && rowById.has(firstParent) ? firstParent : null;
    for (const parent of commit.parents.slice(1)) {
      if (!rowById.has(parent) || active.includes(parent)) continue;
      const free = active.indexOf(null);
      if (free === -1) active.push(parent);
      else active[free] = parent;
    }
    rows.push({ commit, lane });
  }

  const laneByCommit = new Map<string, number>();
  for (const row of rows) {
    if (!laneByCommit.has(row.commit.id)) laneByCommit.set(row.commit.id, row.lane);
  }

  const edges: GraphEdge[] = [];
  rows.forEach((row, fromRow) => {
    for (const parent of row.commit.parents) {
      const toRow = rowById.get(parent);
      const toLane = laneByCommit.get(parent);
      if (toRow === undefined || toLane === undefined || toRow <= fromRow) continue;
      edges.push({
        fromRow,
        toRow,
        fromLane: row.lane,
        toLane,
        lane: row.lane,
      });
    }
  });

  const laneCount = Math.max(1, ...rows.map((row) => row.lane + 1));
  return { rows, edges, laneCount };
}
