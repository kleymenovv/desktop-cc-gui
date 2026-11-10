import { describe, expect, it } from "vitest";
import type { GitCommit } from "@/lib/ipc";
import { computeGraph } from "./history-graph";

function commit(id: string, parents: string[] = []): GitCommit {
  return {
    id,
    shortId: id.slice(0, 7),
    parents,
    author: "dev",
    time: 0,
    summary: id,
    refs: [],
    isHead: false,
  };
}

describe("computeGraph", () => {
  it("keeps a linear history in one lane", () => {
    const layout = computeGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
    expect(layout.edges.map((edge) => [edge.fromRow, edge.toRow])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("gives a merge's second parent its own lane and joins at the base", () => {
    // m ──┬── a ──┐
    //     └── b ──┴── c
    const layout = computeGraph([
      commit("m", ["a", "b"]),
      commit("a", ["c"]),
      commit("b", ["c"]),
      commit("c"),
    ]);
    expect(layout.rows.map((row) => [row.commit.id, row.lane])).toEqual([
      ["m", 0],
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
    expect(layout.laneCount).toBe(2);
    // Merge edge m→b crosses lanes 0 → 1; the branch b→c comes back to lane 0.
    expect(layout.edges.map((edge) => [edge.fromRow, edge.toRow, edge.fromLane, edge.toLane])).toEqual([
      [0, 1, 0, 0],
      [0, 2, 0, 1],
      [1, 3, 0, 0],
      [2, 3, 1, 0],
    ]);
  });

  it("ignores parents outside the returned window", () => {
    const layout = computeGraph([commit("b", ["a"])]);
    expect(layout.edges).toEqual([]);
    expect(layout.laneCount).toBe(1);
  });
});
