import { beforeEach, expect, it } from "vitest";
import { projectForFile, resolveProjectBinding } from "./model";
import { useProjectHomeStore } from "./store";
const projects = [
  { id: "one", name: "One", status: "active", primaryWorkspace: { cwd: "/code/app/" } },
  { id: "two", name: "Two", status: "active", primaryWorkspace: { cwd: "/code/other" } },
];
beforeEach(() => useProjectHomeStore.setState({ paths: [], activePath: null, bindings: {} }));
it("matches only one exact folder, never a prefix or project name", () => {
  expect(resolveProjectBinding("/code/app", undefined, 3100, "company", projects)?.id).toBe("one");
  expect(resolveProjectBinding("/code", undefined, 3100, "company", projects)).toBeUndefined();
  expect(resolveProjectBinding("/code/application", undefined, 3100, "company", projects)).toBeUndefined();
  expect(resolveProjectBinding("/code/app", undefined, 3100, "company", [...projects, { ...projects[0], id: "three" }])).toBeUndefined();
});
it("explicit choices survive path differences and stay scoped to the connection and company", () => {
  const binding = { port: 3100, companyId: "company", projectId: "two" };
  expect(resolveProjectBinding("/code/app", binding, 3100, "company", projects)?.id).toBe("two");
  expect(resolveProjectBinding("/code/app", binding, 3100, "other", projects)).toBeUndefined();
  expect(resolveProjectBinding("/code/app", binding, 3200, "company", projects)).toBeUndefined();
  expect(resolveProjectBinding("/code/app", null, 3100, "company", projects)).toBeUndefined();
});
it("opens projects once and closes only the requested project tab", () => {
  const store = useProjectHomeStore.getState();
  store.open("/code/app"); store.open("/code/other"); store.open("/code/app");
  expect(useProjectHomeStore.getState().paths).toEqual(["/code/app", "/code/other"]);
  store.close("/code/other");
  expect(useProjectHomeStore.getState().activePath).toBe("/code/app");
  store.deactivate();
  expect(useProjectHomeStore.getState().paths).toEqual(["/code/app"]);
  expect(useProjectHomeStore.getState().activePath).toBeNull();
});
it("persists an explicit unlink so folder inference does not relink it", () => {
  useProjectHomeStore.getState().bind("/code/app/", null);
  expect(useProjectHomeStore.getState().bindings["/code/app"]).toBeNull();
  expect(JSON.parse(localStorage.getItem("ccgui.projectBindings.v1")!)).toMatchObject({ "/code/app": null });
});

it("keeps file editing in the owning project, with segment boundaries and nested roots", () => {
  expect(projectForFile("/code/app/src/file.ts", ["/code", "/code/app"])).toBe("/code/app");
  expect(projectForFile("/code/application/file.ts", ["/code/app"])).toBeUndefined();
  expect(projectForFile(null, ["/code/app"])).toBeUndefined();
});
