// Protocol smoke check against the real helper. No screenshots or input.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, "src-tauri/target/debug", `ccgui-computer-use${process.platform === "win32" ? ".exe" : ""}`);
const reports = [];
const fixture = mkdtempSync(join(tmpdir(), "ccgui-mcp-prewarm-"));
const native = process.platform === "win32" ? null : join(fixture, "native-fixture");
if (native) writeFileSync(native, `#!/bin/sh
printf '%s\n' "$1" >> "$CCGUI_TEST_NATIVE_CALLS"
printf '%s' '{"ok":true,"data":{"session_id":"smoke-session"}}'
`, { mode: 0o700 });
const control = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, "Bearer protocol-test");
  let body = "";
  for await (const chunk of request) body += chunk;
  reports.push({ endpoint: request.url, ...JSON.parse(body) });
  response.writeHead(200).end();
});
control.listen(0, "127.0.0.1");
await once(control, "listening");
const child = spawn(executable, [], { cwd: root, env: {
  ...process.env, CCGUI_AGENT_DESKTOP_BIN: native || "", CCGUI_TEST_NATIVE_CALLS: join(fixture, "calls"), CCGUI_CU_CONTROL: `http://127.0.0.1:${control.address().port}`,
  CCGUI_CU_TOKEN: "protocol-test",
  // Regression: provider proxies must not swallow local cursor reports.
  HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1",
  ALL_PROXY: "http://127.0.0.1:1", NO_PROXY: "", no_proxy: "",
}, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.setEncoding("utf8").on("data", (data) => { stderr = (stderr + data).slice(-8000); });
const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter(message); }
});
let nextId = 0;
const timeout = setTimeout(() => child.kill(), 10_000);
const exited = once(child, "exit");
function request(method, params) {
  const id = ++nextId;
  const answer = new Promise((done) => pending.set(id, done));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return Promise.race([answer, exited.then(() => { throw new Error(`Helper exited early: ${stderr}`); })]);
}
let sharedHome;
try {
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ccgui-protocol-test", version: "1.0" } });
  assert.ok(init.result?.capabilities.tools);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const catalog = await request("tools/list", {});
  const tools = catalog.result.tools;
  const desktop = tools.find((tool) => tool.name === "desktop");
  assert.ok(desktop, "Semantic desktop tool is exposed");
  assert.ok(tools.find((tool) => tool.name === "prepare_desktop_team"), "Single-call team preparation is exposed");
  assert.ok(desktop.inputSchema.properties.agent_id, "Desktop workers have explicit namespaces");
  assert.ok(desktop.inputSchema.properties.team_id, "Workers can attach from separate MCP processes");
  assert.ok(tools.find((tool) => tool.name === "screenshot"), "Screenshot fallback remains available");
  assert.ok(tools.find((tool) => tool.name === "sequence"), "Existing batch tool remains available");
  // Unknown commands must fail before starting any native desktop process.
  const denied = await request("tools/call", { name: "desktop", arguments: { command: "sandbox" } });
  assert.ok(denied.error || denied.result?.isError);
  if (native) {
    for (let i = 0; i < 2; i++) {
      const prepared = await request("tools/call", { name: "prepare_desktop_team", arguments: {} });
      assert.equal(prepared.result?.isError ?? false, false, JSON.stringify(prepared));
      const team = JSON.parse(prepared.result.content[0].text);
      assert.match(team.team_id, /^[0-9a-f-]{36}$/);
      sharedHome = join(tmpdir(), `ccgui-desktop-${team.team_id}`);
      const state = readFileSync(join(sharedHome, "team-session.json"), "utf8");
      assert.equal(state.includes("protocol-test"), false, "Shared metadata must not expose the GUI token");
      assert.deepEqual(team.agents.map((agent) => agent.agent_id), ["agent-1", "agent-2", "agent-3"]);
    }
    assert.equal(reports.filter((event) => event.endpoint === "/team").length, 1, "Team preparation is idempotent");
    assert.deepEqual(readFileSync(join(fixture, "calls"), "utf8").trim().split("\n"), ["session"], "Prewarm and repeated team setup share one native session");
  }
  child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0, stderr);
  if (sharedHome) assert.equal(existsSync(sharedHome), false, "Parent EOF revokes the shared team");
  assert.deepEqual(reports.filter((event) => event.endpoint === "/session").map((event) => event.active), [true, false]);
  assert.equal(reports.some((event) => event.endpoint === "/cursor"), false);
  console.log(`MCP smoke check passed: ${tools.length} tools, authenticated overlay lifecycle, clean EOF, no desktop actions.`);
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null) child.kill();
  lines.close();
  control.close();
  rmSync(fixture, { recursive: true, force: true });
}
