(() => {
  const glyphs = { move: "↖", click: "◉", "double-click": "2×", "right-click": "◉", drag: "↔", scroll: "↕", type: "⌨", key: "⌨", select: "▣", check: "✓", uncheck: "□", expand: "⊞", collapse: "⊟", clear: "⌫", "set-value": "⌨", "scroll-to": "↕", launch: "↗" };
  const glyph = document.getElementById("glyph");
  const label = document.getElementById("label");
  const keycap = document.getElementById("keycap");
  const ripple = document.getElementById("ripple");
  function update(action) {
    const colors = { "agent-1": "#70b6ff", "agent-2": "#34d399", "agent-3": "#fb923c" };
    document.documentElement.style.setProperty("--agent-accent", colors[action.agentId] || "#70b6ff");
    glyph.classList.toggle("preparing", action.kind === "preparing");
    glyph.textContent = (action.kind === "preparing" ? "◌" : glyphs[action.kind]) || "↖";
    label.textContent = [action.agentId ? `#${action.agentId.slice(-1)}` : "", action.label || ""].filter(Boolean).join(" · ");
    const keyNames = { cmd: "⌘", command: "⌘", meta: "⌘", ctrl: "⌃", control: "⌃", shift: "⇧", alt: "⌥", option: "⌥", enter: "↵", return: "↵", esc: "⎋", escape: "⎋", tab: "⇥", space: "␣", backspace: "⌫", delete: "⌦", up: "↑", down: "↓", left: "←", right: "→" };
    keycap.textContent = action.keys ? action.keys.split("+").map((key) => keyNames[key.toLowerCase()] || key.toUpperCase()).join(" ") : (action.textLength != null ? `••• · ${action.textLength}` : "");
    ripple.classList.remove("active");
    if (["click", "double-click", "right-click", "select", "check", "uncheck"].includes(action.kind)) {
      void ripple.offsetWidth;
      ripple.classList.add("active");
    }
  }
  window.ccguiCursor = { update };
  if (window.__CCGUI_CURSOR_STATE__) update(window.__CCGUI_CURSOR_STATE__);
})();
