# Desktop automation in CC GUI

The pointer button beside the composer permits computer use for **one message**.
Send the task normally; the agent chooses whether to call the desktop tools.
The permission resets after submission or a conversation/engine switch. Queued
messages retain their own flag. `/ccgui-cua <task>` remains supported.

Settings → Computer Use shows the bundled agent-desktop version and the OS
permission status. macOS grants must be made by the user in System Settings.
Screen Recording is needed for screenshots; semantic accessibility actions do
not require it. The active turn has a Stop control; global Escape targets running
computer-use conversations even after switching tabs.

## Implementation

- The existing engine adapters mount `ccgui-computer-use` only for an explicitly
  authorized send. Ordinary chat never receives these tools.
- Its new `desktop` MCP tool uses a closed command schema, then directly starts
  the bundled native executable. No shell, arbitrary flags, runtime download, or
  global CLI installation is involved.
- After the explicitly authorized MCP connection initializes, a background task
  prepares private temporary state and an isolated session while the model plans. Calls
  within the helper share that session. Closing the helper removes its refmaps.
  A hard crash can leave an inert private directory in the OS temporary folder;
  no agent-desktop cursor daemon is started.
- Observation, app launch and semantic ref actions are available; static text is
  preserved by default. `skeleton`, `root`, `surface`, and `interactive_only`
  support large apps, menus and dialogs. The existing screenshot and coordinate
  tools remain available for controls absent from accessibility trees.
- Mutations are never retried automatically. Upstream JSON, including delivery
  and retry disposition, is preserved. Text entry goes through stdin. Execution
  is bounded to 30 seconds per child command, and timed-out children are killed
  and reaped. CC GUI's existing engine process-tree cleanup handles Stop/exit.
- The app-owned pointer and target outline use screen coordinates, join all
  workspaces and fullscreen spaces, and do not take focus or intercept clicks.
  Before a mutation, the driver waits for the authenticated `/action` preview
  acknowledgement (including page readiness and a 180 ms glide). Preview failure
  stops the operation before input. Labels show target names, key chords and
  character counts; typed values are never included. The Settings pointer preview
  displays for three seconds and does not perform any input.

## Fast team preparation

The explicit computer-use send immediately displays a preparation cursor using
only CC GUI window geometry. No other app is read before a tool request.
`prepare_desktop_team` prepares three app-owned blue/green/orange cursors and
returns `agent-1`, `agent-2`, `agent-3` in one call; repeat preparation is idempotent.
It does **not** spawn model agents. The requesting model delegates independent
subtasks using its engine's subagent facility, if available. The tool also returns
an opaque `team_id`. Every delegated worker must pass
**both** `team_id` and `agent_id` on every `desktop` call, including its first
snapshot. This joins the parent's session even when the engine creates a
separate MCP process for each subagent. Each worker observes its own window.
Preparation itself does not schedule model agents.

The parent helper owns a random private directory and publishes the native
session id with a hash binding it to the current GUI control channel. Borrowers
validate the capability and instance binding; they never create a missing team
or delete its directory. Closing the parent removes the state and revokes the
team. A borrower closing its MCP connection does not hide the parent's cursors.
Session metadata never contains the GUI bearer token or an executable path.

Independent semantic workers run concurrently; calls within a worker remain
ordered. Physical desktop calls, app launches and the legacy input tools share
an exclusive input guard backed by OS file locks, so keyboard/focus changes
cannot overlap semantic actions across separate helper processes. Worker calls
also hold per-worker OS locks; unrelated semantic workers hold shared input locks.
Lock waits are bounded and cancellable without orphan blocking threads. Each cursor has separate readiness and cancellation state. Parent Stop/EOF
hides all cursors, and subsequent turns prepare a new isolated session.

Preparation removes manual shell/setup round trips. Model latency, app response
time and the visible 180 ms pre-input preview remain. No measured end-to-end
speedup is claimed.


## Build and verification

Local verification builds use the normal **CC GUI** name and
`com.zhukunpenglinyutong.ccgui` bundle identifier. Install the validated bundle
at `/Applications/CC GUI.app`, replacing the previous app instead of running
parallel copies from build directories. Preserve the previous bundle outside an
`.app` directory for rollback. User data remains in `~/.ccgui-next`.

A stable Developer ID signature preserves macOS permission identity across
updates. When that identity is unavailable, a local ad-hoc build can need fresh
OS permission grants after replacement; do not claim those grants survive.

`agent-desktop` is pinned to 1.2.0, which meets this repository's seven-day package
age rule. `scripts/prepare-agent-desktop.mjs` verifies upstream binary SHA-256
digests and stages only the target architecture's executables. Tauri's dev/build
hooks run it automatically. Full Apache-2.0 license text ships in app resources.

For direct Cargo builds/tests after a fresh checkout:

```sh
pnpm install --frozen-lockfile
node scripts/prepare-agent-desktop.mjs
cargo test --manifest-path src-tauri/Cargo.toml --bin ccgui-computer-use
cargo test --manifest-path src-tauri/Cargo.toml --lib computer_use::tests
cargo build --manifest-path src-tauri/Cargo.toml --bin ccgui-computer-use
node scripts/verify-computer-use-mcp.mjs
```

The protocol smoke check uses a real helper and authenticated loopback receiver,
checks tool discovery and EOF cleanup, and performs no desktop actions. Driver
tests cover lazy initialization, concurrent session reuse, uncertain errors,
timeouts and private-state cleanup. Frontend tests cover one-message permission,
attachments, queued messages, capability changes and tab switches.

For a native visual smoke check, start the installed executable with
`--show-computer-cursor`. It renders the pointer for three seconds and reports
`[cu-overlay] visual preview ready` only after the page loaded and the native
window became visible. It reads no other app and sends no keyboard/mouse input.
