import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskSplit } from "./TaskSplit";
import "@/lib/i18n";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, measure: () => void, container = 1200;
const disconnect = vi.fn();
beforeEach(() => {
  localStorage.clear(); container = 1200;
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { measure = cb; } observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: container } as DOMRect));
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (visible = true) => { await act(async () => root.render(<TaskSplit visible={visible} detail={<aside className="pc-detail" />}><main className="pc-main"><textarea defaultValue="Keep draft" /></main></TaskSplit>)); };
const separator = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const width = () => Number(separator().getAttribute('aria-valuenow'));
const pointer = async (kind: string, x: number) => { await act(async () => {
  const event = new Event(kind, { bubbles: true }); Object.assign(event, { clientX: x, pointerId: 1, button: 0 }); separator().dispatchEvent(event);
}); };
it("resizes both panes without remounting drafts and saves only a completed drag", async () => {
  await render(); const before = width(), draft = host.querySelector("textarea");
  await pointer("pointerdown", 600); await pointer("pointermove", 400);
  expect(width()).toBe(before + 200); expect(host.querySelector("textarea")).toBe(draft);
  expect(localStorage.getItem("paperclip:task-detail-width")).toBeNull();
  await pointer("pointerup", 400); expect(localStorage.getItem("paperclip:task-detail-width")).toBe(String(before + 200));
});
it("restores the starting width on cancellation or a hidden view", async () => {
  await render(); const before = width(); await pointer("pointerdown", 600); await pointer("pointermove", 400); await pointer("pointercancel", 400);
  expect(width()).toBe(before); expect(localStorage.getItem("paperclip:task-detail-width")).toBeNull();
  await pointer("pointerdown", 600); await pointer("pointermove", 400); await render(false);
  expect(width()).toBe(before); expect(host.querySelector('[data-resizing]')).toBeNull();
});
it("clamps container resizes, supports keyboard limits and resets the preference", async () => {
  await render();
  await act(async () => separator().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(width()).toBe(912);
  container = 900; await act(async () => measure()); expect(width()).toBe(612);
  await act(async () => separator().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(width()).toBe(320);
  await act(async () => separator().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(localStorage.getItem("paperclip:task-detail-width")).toBeNull(); expect(width()).toBe(396);
});
it("restores the saved width while isolating a corrupted layout preference", async () => {
  localStorage.setItem("paperclip:task-detail-width", "650"); await render(); expect(width()).toBe(650);
  await act(async () => root.render(<div />)); localStorage.setItem("paperclip:task-detail-width", "NaN");
  await render(); expect(width()).toBe(528);
  container = 700; await act(async () => measure()); expect(host.querySelector('.pc-task-stacked')).not.toBeNull();
});
