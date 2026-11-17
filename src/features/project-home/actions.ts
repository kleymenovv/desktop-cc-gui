import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { useChatStore } from "@/features/chat/store";
import { useProjectHomeStore } from "./store";

export function openProjectHome(path: string) {
  window.location.hash = "#/";
  dismissCenterSurfaces();
  useProjectHomeStore.getState().open(path);
}
export async function startProjectSession(path: string) {
  const chat = useChatStore.getState();
  if (!chat.workspaces.some((w) => w.path === path)) {
    const added = await chat.addWorkspaces([path]);
    if (!added.includes(path)) throw new Error(useChatStore.getState().actionError ?? "Workspace could not be opened");
  }
  if (useProjectHomeStore.getState().activePath !== path) return;
  dismissCenterSurfaces();
  useChatStore.getState().startNewChat(path);
}
