import type { ActivityEvent } from "./api";
export interface ActivityRow {
  id: string; kind: Exclude<ActivityEvent["kind"], "item">; text: string; name: string;
  status: string; time: string; seq: number; truncated: boolean;
}
export function mergeActivity(previous: ActivityRow[], incoming: ActivityEvent[]): ActivityRow[] {
  const rows = new Map(previous.map((row) => [row.id, row]));
  for (const event of incoming) {
    const old = rows.get(event.itemId);
    if (old && (event.seq <= old.seq || (old.status === "completed" && event.delta))) continue;
    const kind = event.kind === "item" ? old?.kind : event.kind;
    if (!kind) continue;
    // A loss-resistant completion replaces deltas; it is never appended twice.
    const text = event.text === null ? old?.text ?? "" : event.delta ? (old?.text ?? "") + event.text : event.text;
    const chars = Array.from(text);
    rows.set(event.itemId, {
      id: event.itemId, kind, text: chars.slice(-16_000).join(""), name: event.name || old?.name || "",
      status: old?.status === "failed" ? "failed" : old?.status === "completed" && event.status === "running" ? "completed" : event.status,
      time: old?.time || event.time, seq: event.seq, truncated: chars.length > 16_000 || ((event.delta || event.text === null) && !!old?.truncated),
    });
  }
  return [...rows.values()].slice(-200);
}
export const liveStatus = (status: string) => ["running", "queued", "deferred"].includes(status);
