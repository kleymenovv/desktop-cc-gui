import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const avatar = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ paperclipApi: { avatar } }));
vi.mock("./store", () => ({ usePaperclipStore: (select: (s: unknown) => unknown) => select({ config: { port: 3100 } }) }));
import type { Agent } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
let Portrait: typeof import("./AgentPortrait").AgentPortrait;
const agent: Agent = { id: "agent-one", name: "Engineer", role: "engineer", title: null, status: "idle", adapterType: "codex_local", reportsTo: null, budgetMonthlyCents: 0, spentMonthlyCents: 0, appearance: { schemaVersion: 1, characterVersion: "cap-v1", paletteId: "pink-lemonade" } };
const image = "data:image/png;base64,mock-image";
beforeEach(async () => {
  vi.resetModules(); avatar.mockReset();
  Portrait = (await import("./AgentPortrait")).AgentPortrait;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("shares requests for the same Paperclip appearance and reuses the cached image", async () => {
  avatar.mockResolvedValue(image);
  await act(async () => root.render(<><Portrait agent={agent} /><Portrait agent={{ ...agent, id: "agent-two" }} /></>));
  expect(avatar).toHaveBeenCalledTimes(1);
  expect(avatar).toHaveBeenCalledWith("pink-lemonade", null, 3100);
  expect(host.querySelectorAll("img")).toHaveLength(2);
  await act(async () => root.render(<Portrait agent={{ ...agent, name: "Renamed", status: "running" }} />));
  expect(avatar).toHaveBeenCalledTimes(1);
});

it("does not overwrite a newly selected appearance with a late image", async () => {
  let first!: (value: string) => void;
  avatar.mockImplementation((palette) => palette === "pink-lemonade" ? new Promise<string>((resolve) => { first = resolve; }) : Promise.resolve("data:image/png;base64,new-image"));
  await act(async () => root.render(<Portrait agent={agent} />));
  await act(async () => root.render(<Portrait agent={{ ...agent, appearance: { ...agent.appearance!, paletteId: "arctic-blue" } }} />));
  await act(async () => first(image));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,new-image");
});

it("keeps a stable colorful role fallback when an avatar cannot be loaded", async () => {
  avatar.mockRejectedValue(new Error("Avatar unavailable"));
  await act(async () => root.render(<Portrait agent={agent} />));
  const before = host.querySelector<HTMLElement>(".pc-agent-portrait")!.style.getPropertyValue("--portrait-hue");
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".pc-portrait-fallback")).not.toBeNull();
  await act(async () => root.render(<Portrait agent={{ ...agent, name: "Another name" }} />));
  expect(host.querySelector<HTMLElement>(".pc-agent-portrait")!.style.getPropertyValue("--portrait-hue")).toBe(before);
  expect(avatar).toHaveBeenCalledTimes(1);
});

it("does not fetch from hidden views and uses the custom asset when present", async () => {
  avatar.mockResolvedValue(image);
  const custom = { ...agent, appearance: { ...agent.appearance!, customAvatarAssetId: "asset-one" } };
  await act(async () => root.render(<Portrait agent={custom} visible={false} />));
  expect(avatar).not.toHaveBeenCalled();
  await act(async () => root.render(<Portrait agent={custom} visible />));
  expect(avatar).toHaveBeenCalledWith(null, "asset-one", 3100);
});

it("limits concurrent image requests to four", async () => {
  const resolvers: ((value: string) => void)[] = [];
  avatar.mockImplementation(() => new Promise<string>((resolve) => resolvers.push(resolve)));
  await act(async () => root.render(<>{Array.from({ length: 12 }, (_, i) => <Portrait key={i} agent={{ ...agent, id: `agent-${i}`, appearance: { ...agent.appearance!, customAvatarAssetId: `asset-${i}` } }} />)}</>));
  expect(avatar).toHaveBeenCalledTimes(4);
  while (resolvers.length) await act(async () => { for (const resolve of resolvers.splice(0)) resolve(image); });
  expect(avatar).toHaveBeenCalledTimes(12);
});
