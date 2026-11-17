import { beforeEach, afterEach, expect, it, vi, type MockInstance } from "vitest";
import { useChatStore } from "@/features/chat/store";
import { useProjectHomeStore } from "./store";
import { startProjectSession } from "./actions";
vi.mock("@/features/chat/center-surfaces", () => ({ dismissCenterSurfaces: vi.fn() }));
let start: MockInstance<(path: string) => void>;
let add: MockInstance<(paths: string[]) => Promise<string[]>>;
beforeEach(() => {
  useProjectHomeStore.setState({ paths: ["/code/app"], activePath: "/code/app" });
  useChatStore.setState({ workspaces: [], actionError: null });
  start = vi.spyOn(useChatStore.getState(), "startNewChat").mockImplementation(() => {});
  add = vi.spyOn(useChatStore.getState(), "addWorkspaces");
});
afterEach(() => vi.restoreAllMocks());
it("registers the exact project folder before opening a new session", async () => {
  add.mockResolvedValue(["/code/app"]);
  await startProjectSession("/code/app");
  expect(add).toHaveBeenCalledExactlyOnceWith(["/code/app"]);
  expect(start).toHaveBeenCalledExactlyOnceWith("/code/app");
});
it("keeps the project visible when its folder cannot be registered", async () => {
  add.mockResolvedValue([]);
  useChatStore.setState({ actionError: "Directory missing" });
  await expect(startProjectSession("/code/app")).rejects.toThrow("Directory missing");
  expect(start).not.toHaveBeenCalled();
});
it("does not steal focus after the user switches projects during registration", async () => {
  let resolve!: (value: string[]) => void;
  add.mockReturnValue(new Promise((r) => { resolve = r; }));
  const pending = startProjectSession("/code/app");
  useProjectHomeStore.getState().open("/code/other");
  resolve(["/code/app"]);
  await pending;
  expect(start).not.toHaveBeenCalled();
});
