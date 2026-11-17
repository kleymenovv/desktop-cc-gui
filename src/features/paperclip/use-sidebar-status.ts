import { useEffect } from "react";
import { isWeb } from "@/lib/transport";
import { usePaperclipStore } from "./store";

/** Only saved local connection metadata is read; no worker is started. */
export function useSidebarStatus(enabled = true) {
  useEffect(() => {
    if (isWeb || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const tick = async () => {
      if (disposed || pending || document.visibilityState === "hidden") return;
      pending = true;
      clearTimeout(timer);
      try {
        await usePaperclipStore.getState().initialize();
        if (disposed) return;
        const state = usePaperclipStore.getState();
        if (!state.statusUpdatedAt || Date.now() - state.statusUpdatedAt >= 10_000) {
          await state.refreshStatus();
        }
      } catch {
        // Connection failures live in the store, rendered as an offline marker.
      } finally {
        pending = false;
        if (!disposed) timer = setTimeout(() => { void tick(); }, 10_000);
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
