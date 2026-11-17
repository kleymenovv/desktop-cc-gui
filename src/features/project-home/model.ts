import type { Project } from "@/features/paperclip/api";
import { normalizeProjectPath, type ProjectBinding } from "./store";

export function resolveProjectBinding(path: string, saved: ProjectBinding | null | undefined, port: number | undefined, companyId: string, projects: Project[]): Project | undefined {
  if (saved === null) return undefined;
  if (saved) return saved.port === port && saved.companyId === companyId ? projects.find((p) => p.id === saved.projectId) : undefined;
  const matches = projects.filter((p) => p.primaryWorkspace?.cwd && normalizeProjectPath(p.primaryWorkspace.cwd) === normalizeProjectPath(path));
  return matches.length === 1 ? matches[0] : undefined;
}


/** Match complete directory segments; nested projects own their own files. */
export function projectForFile(file: string | null, paths: string[]): string | undefined {
  if (!file) return undefined;
  const normalized = normalizeProjectPath(file);
  return paths.filter((path) => {
    const root = normalizeProjectPath(path);
    return normalized.startsWith(root === "/" ? "/" : `${root}/`);
  }).sort((a, b) => b.length - a.length)[0];
}
