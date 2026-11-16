import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { useChatStore, type ActiveSession } from "../store";
import { useComposerActions } from "./use-composer-actions";
import { EMPTY_SESSION } from "../store/stream";
import { ComputerUseControl } from "./ComputerUseControl";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";

vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()), isWeb: false,
}));
vi.mock("../prompt-history", () => ({ recordPrompt: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const send = vi.fn();
const queueMessage = vi.fn();
const setDraft = vi.fn();
const setSessionError = vi.fn();
const stop = vi.fn();
const input = createRef<ComposerInputHandle>();
const active: ActiveSession = { engine: "claude", sessionId: "one", workspacePath: "/tmp/work" };
let actions: ReturnType<typeof useComposerActions>;
let root: Root;
let container: HTMLDivElement;

function Harness({ target = active, streaming = false, images = [] }: {
  target?: ActiveSession; streaming?: boolean; images?: string[];
}) {
  const key = `${target.engine}/${target.sessionId}`;
  actions = useComposerActions({ active: target, sessionKey: key, streaming, images,
    clearImages: vi.fn(), importImageFiles: vi.fn(), supportsImages: true, composerInputRef: input });
  return <ComputerUseControl sessionKey={key} engine={target.engine} armed={actions.computerUseArmed}
    onToggle={actions.toggleComputerUse} onStop={stop} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({ active, engines: [{ id: "claude", available: true, enabled: true,
    supportsImages: true, supportsComputerUse: true, permissions: ["auto"] }],
    send, queueMessage, setDraft, setSessionError, pendingMention: null, bySession: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("composer computer-use permission", () => {
  it("is explicit, applies to one message including attachments, and resets after send", () => {
    act(() => root.render(<Harness images={["/tmp/picture.png"]} />));
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    act(() => container.querySelector("button")!.click());
    expect(actions.computerUseArmed).toBe(true);
    act(() => actions.submit("Fill the form"));
    expect(send).toHaveBeenLastCalledWith("Fill the form", ["/tmp/picture.png"], { computerUse: true }, active);
    expect(actions.computerUseArmed).toBe(false);
    act(() => actions.submit("Explain the result"));
    expect(send).toHaveBeenLastCalledWith("Explain the result", ["/tmp/picture.png"], undefined, active);
  });

  it("captures the flag in queued messages without authorizing subsequent messages", () => {
    act(() => root.render(<Harness streaming />));
    act(() => actions.toggleComputerUse());
    act(() => actions.submit("Do this next"));
    expect(queueMessage).toHaveBeenLastCalledWith("Do this next", [], { computerUse: true }, active);
    act(() => actions.submit("Then explain"));
    expect(queueMessage).toHaveBeenLastCalledWith("Then explain", [], undefined, active);
  });

  it("does not restore an armed permission when switching away and back", () => {
    act(() => root.render(<Harness />));
    act(() => actions.toggleComputerUse());
    act(() => root.render(<Harness target={{ ...active, sessionId: "two" }} />));
    expect(actions.computerUseArmed).toBe(false);
    act(() => root.render(<Harness />));
    expect(actions.computerUseArmed).toBe(false);
  });

  it("refuses an engine whose capability changed without clearing the draft", () => {
    act(() => root.render(<Harness />));
    act(() => actions.toggleComputerUse());
    act(() => useChatStore.setState({ engines: [] }));
    act(() => actions.submit("Keep this draft"));
    expect(send).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(setSessionError).toHaveBeenCalled();
  });

  it("keeps the slash command and offers an independent stop for a running turn", () => {
    act(() => root.render(<Harness />));
    act(() => actions.submit("/ccgui-cua Open Calculator"));
    expect(send).toHaveBeenLastCalledWith("Open Calculator", [], { computerUse: true }, active);
    act(() => useChatStore.setState({ bySession: {
      "claude/one": { ...EMPTY_SESSION, streaming: true, activeComputerUse: true },
    } }));
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    act(() => buttons[1].click());
    expect(stop).toHaveBeenCalledOnce();
  });
});
