import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { usePaperclipStore } from "./store";

export function openPaperclipTeam(): void {
  window.location.hash = "#/";
  dismissCenterSurfaces();
  usePaperclipStore.getState().openTeam();
}
