import i18n from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/base/buttons/button";
import { withGrantRetry } from "@/lib/grant";
import { useComposerFileDrop } from "@/features/chat/components/use-composer-file-drop";
import { paperclipApi, type Issue } from "./api";

export interface TaskFile { id: string; file: File }
export interface TaskAttachment { id: string; originalFilename: string | null; byteSize: number; sha256: string; contentPath: string }
export interface TaskSubmission { key: string; issue?: Issue; staged?: boolean }
const MAX = 10 * 1024 * 1024;
export function TaskAttachmentDrop({ files, onChange, disabled, children, onReading }: { onReading?: (reading: boolean) => void; files: TaskFile[]; onChange: (files: TaskFile[]) => void; disabled: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const reads = useRef(0);
  const filesRef = useRef(files); filesRef.current = files;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const add = (incoming: File[]) => {
    if (disabledRef.current || !mounted.current) return;
    const current = [...filesRef.current]; let rejected = false;
    for (const file of incoming) {
      if (!file.size || file.size > MAX || current.length >= 10 || current.reduce((sum, f) => sum + f.file.size, 0) + file.size > 40 * MAX) { rejected = true; continue; }
      current.push({ id: crypto.randomUUID(), file });
    }
    filesRef.current = current; onChange(current); setError(rejected ? t("paperclip.files.limits") : null);
  };
  const { dropRef, isDragOver } = useComposerFileDrop({ disabled, onDropFiles: add, onDropPaths: (paths) => {
    reads.current++; onReading?.(true);
    void (async () => {
      try { for (const path of paths) {
        if (!mounted.current) return;
        try {
          const value = await withGrantRetry(() => paperclipApi.attachmentFile(path));
          const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0));
          const ext = value.name.split(".").at(-1)?.toLowerCase();
          const type = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
          add([new File([bytes], value.name, { type })]);
        } catch (e) { if (mounted.current) setError(String(e)); }
      } } finally { reads.current--; if (mounted.current) onReading?.(reads.current > 0); }
    })();
  } });
  return <div ref={dropRef} className={`pc-attachment-drop ${isDragOver ? "pc-attachment-over" : ""}`} onPaste={(event) => {
    if (disabled) return;
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) { event.preventDefault(); add(pasted); }
  }}>{children}<div className="pc-attachments-picker"><label className="pc-attach-action"><Paperclip size={15} aria-hidden />{t("paperclip.files.attach")}<input type="file" multiple disabled={disabled} onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label><span>{t("paperclip.files.hint")}</span></div>
    {!!files.length && <div className="pc-attachment-list">{files.map((entry) => <AttachmentChip key={entry.id} entry={entry} disabled={disabled} onRemove={() => onChange(files.filter((file) => file.id !== entry.id))} />)}</div>}
    {error && <p className="pc-attachment-error" role="alert">{error}</p>}
  </div>;
}
function AttachmentChip({ entry, disabled, onRemove }: { entry: TaskFile; disabled: boolean; onRemove: () => void }) {
  const { t } = useTranslation(); const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(entry.file.type)) return;
    const url = URL.createObjectURL(entry.file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [entry.file]);
  return <div className="pc-attachment-chip">{preview ? <img src={preview} alt="" /> : <FileText size={22} aria-hidden />}<span><strong>{entry.file.name}</strong><small>{Math.ceil(entry.file.size / 1024)} KB</small></span><Button size="small" variant="ghost" iconOnly leadingIcon={X} disabled={disabled} aria-label={`${t("paperclip.files.remove")}: ${entry.file.name}`} onClick={onRemove} /></div>;
}
async function encode(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
export async function submitTaskFiles(submission: TaskSubmission, companyId: string, port: number, body: Record<string, unknown>, files: TaskFile[]): Promise<Issue> {
  if (submission.staged === undefined) submission.staged = files.length > 0;
  if (!submission.issue) submission.issue = await paperclipApi.request<Issue>("createIssue", companyId, { ...body, idempotencyKey: submission.key, ...(submission.staged ? { assigneeAgentId: null, status: "backlog" } : {}) });
  const issue = submission.issue;
  if (!submission.staged) return issue;
  const existing = [...await paperclipApi.request<TaskAttachment[]>("attachments", issue.id)];
  for (const { file } of files) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
    if (existing.some((a) => a.sha256 === hash && a.originalFilename === file.name && a.byteSize === file.size)) continue;
    const attachment = await paperclipApi.request<TaskAttachment>("uploadAttachment", issue.id, { companyId, expectedPort: port, name: file.name, contentType: file.type || "application/octet-stream", base64: await encode(file) });
    existing.push(attachment);
  }
  // Upload retries never send the same assignment again after an ambiguous response.
  const latest = await paperclipApi.request<Issue>("issue", issue.id);
  if (latest.status === body.status && latest.assigneeAgentId === body.assigneeAgentId) return latest;
  if (latest.status !== "backlog" || latest.assigneeAgentId) throw new Error(i18n.t("paperclip.files.changed"));
  return paperclipApi.request<Issue>("updateIssue", issue.id, { status: body.status, assigneeAgentId: body.assigneeAgentId });
}
