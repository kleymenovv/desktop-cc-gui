import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn(), attachmentFile: vi.fn() }));
vi.mock("./api", () => ({ paperclipApi: api }));
vi.mock("@/features/chat/components/use-composer-file-drop", () => ({ useComposerFileDrop: () => ({ dropRef: { current: null }, isDragOver: false }) }));
import { submitTaskFiles, TaskAttachmentDrop, type TaskFile, type TaskSubmission } from "./task-attachments";
import i18n from "@/lib/i18n";
const body = { title: "Fix", status: "todo", assigneeAgentId: "agent" };
function input() {
  const bytes = new TextEncoder().encode("example");
  const file = new File([bytes], "note.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return [{ id: "file", file }];
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(crypto, "subtle", { configurable: true, value: webcrypto.subtle });
  await i18n.changeLanguage("en"); api.request.mockReset();
});
it("uploads files before assignment and resumes a partially saved task without creating a duplicate", async () => {
  const submission: TaskSubmission = { key: "request" }; const files = input();
  const order: string[] = []; const saved: unknown[] = [];
  let fail = true;
  api.request.mockImplementation(async (action, id, payload) => {
    order.push(action);
    if (action === "createIssue") { expect(payload).toMatchObject({ assigneeAgentId: null, status: "backlog", idempotencyKey: "request" }); return { id: "issue", status: "backlog" }; }
    if (action === "attachments") return saved;
    if (action === "uploadAttachment") {
      if (fail) throw new Error("network");
      const bytes = await files[0].file.arrayBuffer();
      const sha256 = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
      const result = { id: "attachment", sha256, originalFilename: "note.txt", byteSize: 7 }; saved.push(result); return result;
    }
    if (action === "issue") return { id, status: "backlog", assigneeAgentId: null };
    if (action === "updateIssue") { expect(saved).toHaveLength(1); return { id, ...payload }; }
  });
  await expect(submitTaskFiles(submission, "company", 3100, body, files)).rejects.toThrow("network");
  expect(order).not.toContain("updateIssue"); expect(submission.issue?.id).toBe("issue");
  fail = false;
  await submitTaskFiles(submission, "company", 3100, body, files);
  expect(order.filter((v) => v === "createIssue")).toHaveLength(1);
  expect(order.at(-1)).toBe("updateIssue");
  order.length = 0;
  await submitTaskFiles(submission, "company", 3100, body, files);
  expect(order).not.toContain("uploadAttachment");
});
it("assigns an existing staged task after the failed file is removed", async () => {
  api.request.mockImplementation(async (action) => action === "attachments" ? [] : action === "issue" ? { id: "issue", status: "backlog", assigneeAgentId: null } : { id: "issue", ...body });
  await submitTaskFiles({ key: "request", staged: true, issue: { id: "issue" } as never }, "company", 3100, body, []);
  expect(api.request).toHaveBeenCalledWith("updateIssue", "issue", { status: "todo", assigneeAgentId: "agent" });
});
it("accepts clipboard files, keeps plain text paste native, and removes attachments", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Form() { const [files, setFiles] = useState<TaskFile[]>([]); return <TaskAttachmentDrop files={files} onChange={setFiles} disabled={false}><textarea /></TaskAttachmentDrop>; }
  try {
    await act(async () => root.render(<Form />));
    const paste = (files: File[]) => { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { files } }); host.querySelector("textarea")!.dispatchEvent(event); return event; };
    let event!: Event;
    await act(async () => { event = paste(input().map((f) => f.file)); });
    expect(event.defaultPrevented).toBe(true); expect(host.textContent).toContain("note.txt");
    await act(async () => { event = paste([]); }); expect(event.defaultPrevented).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove file: note.txt"]')!.click());
    expect(host.textContent).not.toContain("note.txt");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
