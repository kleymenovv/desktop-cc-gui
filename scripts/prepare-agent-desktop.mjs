// Stage only this target's native executables. No install scripts or downloads:
// pnpm's lockfile verifies the package; each executable has an upstream digest.
import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile, chmod, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("agent-desktop/package.json"));
const { version } = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
const target = process.env.CARGO_BUILD_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE;
const platform = target ? (target.includes("windows") ? "win32" : target.includes("darwin") ? "darwin" : "linux") : process.platform;
const arch = target ? (target.startsWith("aarch64") ? "arm64" : target.startsWith("x86_64") ? "x64" : "unsupported") : process.arch;
if (!["darwin", "win32", "linux"].includes(platform) || !["arm64", "x64"].includes(arch)) {
  throw new Error(`Unsupported agent-desktop target: ${target ?? `${platform}-${arch}`}`);
}
const suffix = platform === "win32" ? ".exe" : "";
const binaries = [`agent-desktop-${platform}-${arch}${suffix}`];
if (platform === "darwin") binaries.push(`agent-desktop-macos-helper-darwin-${arch}`);
if (platform === "linux") binaries.push(`agent-desktop-linux-clipboard-owner-linux-${arch}`);
const destination = join(root, "src-tauri/resources/agent-desktop");
// Verify everything before touching a previous staging directory.
for (const name of binaries) {
  const expected = (await readFile(join(source, "bin", `${name}.sha256`), "utf8")).trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(await readFile(join(source, "bin", name))).digest("hex");
  if (actual !== expected) throw new Error(`agent-desktop checksum mismatch: ${name}`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of binaries) {
  await copyFile(join(source, "bin", name), join(destination, name));
  await chmod(join(destination, name), 0o755);
}
await writeFile(join(destination, "version.json"), JSON.stringify({ version, platform, arch }));
console.log(`Staged agent-desktop ${version} (${platform}-${arch})`);
