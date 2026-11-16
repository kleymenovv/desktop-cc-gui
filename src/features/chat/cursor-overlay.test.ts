import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

const html = readFileSync(resolve("public/cursor.html"), "utf8");
const script = readFileSync(resolve("public/cursor.js"), "utf8");
type CursorWindow = { ccguiCursor?: { update(action: Record<string, unknown>): void }; __CCGUI_CURSOR_STATE__?: Record<string, unknown> };
let cursorWindow: CursorWindow;
beforeEach(() => {
  document.body.innerHTML = html.slice(html.indexOf('<body aria-hidden="true">') + '<body aria-hidden="true">'.length, html.indexOf("</body>"));
  cursorWindow = {};
});

describe("desktop action cursor", () => {
  it("renders target labels as text, never application-provided HTML", () => {
    runInNewContext(script, { window: cursorWindow, document });
    cursorWindow.ccguiCursor!.update({ kind: "click", label: '<img src=x onerror="alert(1)">' });
    expect(document.getElementById("label")?.textContent).toContain("<img");
    expect(document.querySelector("img")).toBeNull();
    expect(document.getElementById("ripple")?.classList.contains("active")).toBe(true);
  });
  it("shows key chords and a text count without exposing typed content", () => {
    runInNewContext(script, { window: cursorWindow, document });
    cursorWindow.ccguiCursor!.update({ kind: "key", keys: "cmd+shift+s" });
    expect(document.getElementById("keycap")?.textContent).toBe("⌘ ⇧ S");
    cursorWindow.ccguiCursor!.update({ kind: "type", label: "Password", textLength: 12, text: "secret-value" });
    expect(document.getElementById("keycap")?.textContent).toBe("••• · 12");
    expect(document.body.textContent).not.toContain("secret-value");
  });
  it("retains the first action when it arrives before the page loads", () => {
    cursorWindow.__CCGUI_CURSOR_STATE__ = { kind: "click", label: "3" };
    runInNewContext(script, { window: cursorWindow, document });
    expect(document.getElementById("label")?.textContent).toBe("3");
  });
  it("distinguishes workers and resets the accent for single-agent actions", () => {
    runInNewContext(script, { window: cursorWindow, document });
    cursorWindow.ccguiCursor!.update({ kind: "preparing", agentId: "agent-2", label: "CC GUI" });
    expect(document.getElementById("label")?.textContent).toBe("#2 · CC GUI");
    expect(document.documentElement.style.getPropertyValue("--agent-accent")).toBe("#34d399");
    cursorWindow.ccguiCursor!.update({ kind: "click", label: "OK" });
    expect(document.getElementById("label")?.textContent).toBe("OK");
    expect(document.documentElement.style.getPropertyValue("--agent-accent")).toBe("#70b6ff");
  });

});
