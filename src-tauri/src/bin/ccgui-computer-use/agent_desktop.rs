//! Semantic desktop tools, loaded only when a permitted turn calls `desktop`.
//! We execute the pinned native binary directly: no shell, Node, network, or
//! agent-supplied CLI flags. CC GUI owns the pointer and process lifetime.
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use rmcp::schemars;
use serde::Deserialize;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopCommand {
    Snapshot,
    ListApps,
    ListWindows,
    Launch,
    Find,
    Get,
    Click,
    DoubleClick,
    RightClick,
    Type,
    SetValue,
    Clear,
    Select,
    Check,
    Uncheck,
    Expand,
    Collapse,
    ScrollTo,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DesktopParams {
    pub command: DesktopCommand,
    /// Worker returned by prepare_desktop_team. Omit for a single agent.
    pub agent_id: Option<String>,
    /// Shared team capability returned by prepare_desktop_team. Every delegated worker must pass it.
    pub team_id: Option<String>,
    /// Application name. Omit to inspect the focused app.
    pub app: Option<String>,
    /// Window id from list-windows, when an app has multiple windows.
    pub window_id: Option<String>,
    /// Qualified ref from a snapshot/find in THIS turn (e.g. @snapshot:e1).
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    /// Text for type/set-value/select. Delivered over stdin for text entry.
    pub text: Option<String>,
    /// Find filter: accessible role (e.g. button, textfield).
    pub role: Option<String>,
    /// Find filter: accessible name.
    pub name: Option<String>,
    /// get property: text, value, title, bounds, role, or states.
    pub property: Option<String>,
    /// Optional snapshot subtree ref; use to inspect a large app in sections.
    pub root: Option<String>,
    /// Snapshot/find surface: window, menubar, menu, sheet, alert, popover,
    /// focused, dock, or menu-bar-extras. Inspect a newly opened overlay next.
    pub surface: Option<String>,
    /// Take a shallow map before drilling a large app with root.
    #[serde(default)]
    pub skeleton: bool,
    /// Omit static text for a smaller snapshot. Default false preserves labels.
    #[serde(default)]
    pub interactive_only: bool,
    /// Explicitly allow physical input for an operation that needs it.
    /// Defaults false; never retry an uncertain action with this enabled.
    #[serde(default)]
    pub physical: bool,
}

impl DesktopParams {
    fn arguments(&self) -> Result<(Vec<String>, Option<String>), String> {
        if let Some(id) = &self.team_id {
            uuid::Uuid::parse_str(id).map_err(|_| "Invalid desktop team_id")?;
        }
        use DesktopCommand::*;
        let name = match self.command {
            Snapshot => "snapshot",
            ListApps => "list-apps",
            ListWindows => "list-windows",
            Launch => "launch",
            Find => "find",
            Get => "get",
            Click => "click",
            DoubleClick => "double-click",
            RightClick => "right-click",
            Type => "type",
            SetValue => "set-value",
            Clear => "clear",
            Select => "select",
            Check => "check",
            Uncheck => "uncheck",
            Expand => "expand",
            Collapse => "collapse",
            ScrollTo => "scroll-to",
        };
        if self
            .agent_id
            .as_deref()
            .is_some_and(|id| !["agent-1", "agent-2", "agent-3"].contains(&id))
        {
            return Err("Use an agent_id returned by prepare_desktop_team".into());
        }
        let mut args = vec![name.into()];
        let mut stdin = None;
        match self.command {
            Snapshot | Find | ListWindows => {
                for (flag, value) in [("--app", &self.app)] {
                    if let Some(value) = value {
                        args.extend([flag.into(), value.clone()]);
                    }
                }
                if !matches!(self.command, ListWindows) {
                    if let Some(window) = &self.window_id {
                        args.extend(["--window-id".into(), window.clone()]);
                    }
                    if let Some(surface) = &self.surface {
                        if ![
                            "window",
                            "menubar",
                            "menu",
                            "sheet",
                            "alert",
                            "popover",
                            "focused",
                            "dock",
                            "menu-bar-extras",
                        ]
                        .contains(&surface.as_str())
                        {
                            return Err("Unknown accessibility surface".into());
                        }
                        args.extend(["--surface".into(), surface.clone()]);
                    }
                }
                if matches!(self.command, Snapshot) {
                    args.extend(["--compact".into(), "--include-bounds".into()]);
                    if self.skeleton {
                        args.push("--skeleton".into());
                    }
                    if self.interactive_only {
                        args.push("-i".into());
                    }
                    if let Some(root) = &self.root {
                        if self.surface.is_some() {
                            return Err("root and surface cannot be combined".into());
                        }
                        validate_ref(root)?;
                        args.extend(["--root".into(), root.clone()]);
                    }
                } else if matches!(self.command, Find) {
                    if self.role.is_none() && self.name.is_none() {
                        return Err("find needs a role or name filter".into());
                    }
                    for (flag, value) in [("--role", &self.role), ("--name", &self.name)] {
                        if let Some(value) = value {
                            args.extend([flag.into(), value.clone()]);
                        }
                    }
                    args.extend(["--limit".into(), "20".into()]);
                }
            }
            ListApps => {}
            Launch => {
                let app = self
                    .app
                    .as_deref()
                    .filter(|s| !s.is_empty() && !s.starts_with('-'))
                    .ok_or("launch needs an application name")?;
                args.push(app.into());
            }
            _ => {
                let reference = self
                    .reference
                    .as_deref()
                    .ok_or("This command needs a ref from desktop snapshot/find")?;
                validate_ref(reference)?;
                args.push(reference.into());
                match self.command {
                    Type | SetValue => {
                        let text = self.text.as_deref().ok_or("This command needs text")?;
                        if text.len() > 10_000 || text.contains('\0') {
                            return Err(
                                "text must be at most 10,000 UTF-8 bytes without NUL".into()
                            );
                        }
                        args.push("--stdin".into());
                        stdin = Some(text.into());
                    }
                    Select => {
                        args.push(self.text.clone().ok_or("select needs text")?);
                    }
                    Get => {
                        let property = self.property.as_deref().unwrap_or("text");
                        if !["text", "value", "title", "bounds", "role", "states"]
                            .contains(&property)
                        {
                            return Err("Unknown get property".into());
                        }
                        args.extend(["--property".into(), property.into()]);
                    }
                    _ => {}
                }
            }
        }
        if self.physical {
            args.push("--headed".into());
        }
        if let Some(id) = &self.agent_id {
            args.extend(["--agent-id".into(), id.clone()]);
        }
        Ok((args, stdin))
    }
}

fn validate_ref(reference: &str) -> Result<(), String> {
    if !reference.starts_with('@')
        || !reference.contains(':')
        || reference.len() > 160
        || reference.chars().any(char::is_whitespace)
    {
        return Err("Use a qualified ref from this turn's desktop snapshot/find".into());
    }
    Ok(())
}

pub struct AgentDesktop {
    // Initialization is shared; independent semantic workers need not queue.
    session: Mutex<Option<String>>,
    workers: [Mutex<()>; 4],
    input: RwLock<()>,
    team: Mutex<bool>,
    borrowed: AtomicBool,
    shared: bool,
    contexts: Mutex<HashMap<String, Arc<AgentDesktop>>>,
    home: PathBuf,
    binary: Option<PathBuf>,
    timeout: Duration,
}

pub struct InputGuard<'a> {
    _local: tokio::sync::RwLockWriteGuard<'a, ()>,
    _file: File,
}

impl Default for AgentDesktop {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            workers: std::array::from_fn(|_| Mutex::new(())),
            input: RwLock::new(()),
            team: Mutex::new(false),
            borrowed: AtomicBool::new(false),
            shared: false,
            contexts: Mutex::new(HashMap::new()),
            home: std::env::temp_dir().join(format!("ccgui-desktop-{}", uuid::Uuid::new_v4())),
            binary: std::env::var_os("CCGUI_AGENT_DESKTOP_BIN").map(PathBuf::from),
            timeout: Duration::from_secs(30),
        }
    }
}

impl Drop for AgentDesktop {
    fn drop(&mut self) {
        // No native overlay/daemon is started. This directory contains only
        // this helper's private refmaps; never touch the user's global state.
        if !self.shared {
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }
}

impl AgentDesktop {
    fn team_id(&self) -> String {
        self.home
            .file_name()
            .unwrap()
            .to_string_lossy()
            .trim_start_matches("ccgui-desktop-")
            .into()
    }
    fn binding() -> String {
        // Bind the capability to this GUI instance. Never persist the bearer token.
        let value = format!(
            "{}:{}",
            std::env::var("CCGUI_CU_CONTROL").unwrap_or_default(),
            std::env::var("CCGUI_CU_TOKEN").unwrap_or_default()
        );
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }
    fn ensure_home(&self) -> Result<(), String> {
        if self.shared {
            if !self.home.is_dir() {
                return Err("Desktop team expired; prepare a new team in the parent turn".into());
            }
        } else {
            std::fs::create_dir_all(&self.home)
                .map_err(|e| format!("Create desktop state: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&self.home, std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    async fn file_lock(&self, name: &str, exclusive: bool) -> Result<File, String> {
        self.ensure_home()?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(self.home.join(name))
            .map_err(|e| format!("Open desktop team lock: {e}"))?;
        let deadline = tokio::time::Instant::now() + self.timeout;
        loop {
            let result = if exclusive {
                FileExt::try_lock_exclusive(&file)
            } else {
                FileExt::try_lock_shared(&file)
            };
            match result {
                Ok(()) => return Ok(file),
                Err(e) if e.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err("Desktop team is busy; no input was sent".into());
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Err(e) => return Err(format!("Lock desktop team: {e}")),
            }
        }
    }
    pub fn borrows_team(&self) -> bool {
        self.borrowed.load(Ordering::Acquire)
    }
    pub async fn exclusive_input(&self) -> Result<InputGuard<'_>, String> {
        if self.borrows_team() {
            return Err("Delegated team workers must use desktop with team_id and agent_id, including physical=true for shared input".into());
        }
        let local = self.input.write().await;
        let file = self.file_lock("input.lock", true).await?;
        Ok(InputGuard {
            _local: local,
            _file: file,
        })
    }
    pub async fn warmup(&self) -> Result<String, String> {
        let mut session = self.session.lock().await;
        if session.is_none() {
            let _initializing = self.file_lock("session.lock", true).await?;
            let state_path = self.home.join("team-session.json");
            if self.shared {
                let state: Value = serde_json::from_slice(
                    &std::fs::read(&state_path).map_err(|_| "Desktop team expired")?,
                )
                .map_err(|_| "Invalid desktop team state")?;
                if state["binding"].as_str() != Some(Self::binding().as_str()) {
                    return Err("Desktop team belongs to another CC GUI instance".into());
                }
                let id = state["session"]
                    .as_str()
                    .ok_or("Desktop team session is missing")?;
                *session = Some(id.into());
                return Ok(id.into());
            }
            let value = self
                .run(
                    &["session".into(), "start".into(), "--no-trace".into()],
                    None,
                    None,
                )
                .await?;
            if value["ok"] == false {
                return Err(value.to_string());
            }
            let id = value.pointer("/data/session_id").and_then(Value::as_str)
                .ok_or("agent-desktop did not create a session; inspect its returned error before retrying")?;
            let state = serde_json::json!({"session":id,"binding":Self::binding()});
            std::fs::write(
                &state_path,
                serde_json::to_vec(&state).map_err(|e| e.to_string())?,
            )
            .map_err(|e| format!("Share desktop session: {e}"))?;
            *session = Some(id.into());
        }
        Ok(session.as_ref().expect("initialized session").clone())
    }

    pub async fn prepare_team(&self) -> Result<Value, String> {
        self.warmup().await?;
        let mut ready = self.team.lock().await;
        let _preparing = self.file_lock("team.lock", true).await?;
        if !*ready && !self.home.join("team-ready").is_file() {
            tokio::task::spawn_blocking(crate::driver::preview_team)
                .await
                .map_err(|e| e.to_string())??;
            std::fs::write(self.home.join("team-ready"), b"ready").map_err(|e| e.to_string())?;
            *ready = true;
        }
        Ok(serde_json::json!({"team_id":self.team_id(), "agents":[
            {"agent_id":"agent-1","color":"blue"},
            {"agent_id":"agent-2","color":"green"},
            {"agent_id":"agent-3","color":"orange"}
        ],"instructions":"Delegate independent subtasks concurrently using your engine's subagent tool. Each worker must pass BOTH this team_id and its assigned agent_id on EVERY desktop call, including its first snapshot. MCP processes may be separate; the capability joins the same parent-owned session. Each worker must take its own snapshot and work in a separate app/window. This prepares tools and cursors; it does not spawn language-model agents. Do not create shell scripts or configure overlays. Shared keyboard/focus actions are serialized. Verify each worker's result."}))
    }

    pub async fn execute(&self, params: DesktopParams) -> Result<Value, String> {
        params.arguments()?;
        if let Some(team_id) = &params.team_id {
            if team_id != &self.team_id() {
                let context = {
                    let mut contexts = self.contexts.lock().await;
                    if !contexts.contains_key(team_id) && contexts.len() >= 4 {
                        return Err("Too many desktop team attachments in this helper".into());
                    }
                    contexts
                        .entry(team_id.clone())
                        .or_insert_with(|| {
                            let mut context = Self::default();
                            context.home =
                                std::env::temp_dir().join(format!("ccgui-desktop-{team_id}"));
                            context.shared = true;
                            context.binary = self.binary.clone();
                            Arc::new(context)
                        })
                        .clone()
                };
                self.borrowed.store(true, Ordering::Release);
                return context.execute_local(params).await;
            }
        }
        self.execute_local(params).await
    }

    async fn execute_local(&self, params: DesktopParams) -> Result<Value, String> {
        let (args, stdin) = params.arguments()?;
        if self.shared {
            self.warmup().await?;
        }
        let team_ready = *self.team.lock().await || self.home.join("team-ready").is_file();
        if team_ready && params.agent_id.is_none() {
            return Err("Team mode requires an assigned agent_id on every desktop call".into());
        }
        if params.agent_id.is_some() && !team_ready {
            return Err("Call prepare_desktop_team once before assigning desktop workers".into());
        }
        let session = self.warmup().await?;
        let index = match params.agent_id.as_deref() {
            Some("agent-1") => 1,
            Some("agent-2") => 2,
            Some("agent-3") => 3,
            _ => 0,
        };
        let _worker = self.workers[index].lock().await;
        let _worker_file = self
            .file_lock(&format!("worker-{index}.lock"), true)
            .await?;
        // Physical input and launching share system focus. Semantic operations
        // hold a read guard, so no worker changes focus underneath another.
        let exclusive = params.physical || matches!(params.command, DesktopCommand::Launch);
        let (_physical, _semantic) = if exclusive {
            (Some(self.input.write().await), None)
        } else {
            (None, Some(self.input.read().await))
        };
        let _shared_input = self.file_lock("input.lock", exclusive).await?;
        if let Some(kind) = preview_kind(&params.command) {
            let mut bounds = None;
            let mut label = params.app.clone().unwrap_or_default();
            if let Some(reference) = &params.reference {
                let mut bounds_args = vec![
                    "get".into(),
                    reference.clone(),
                    "--property".into(),
                    "bounds".into(),
                ];
                let mut title_args = vec![
                    "get".into(),
                    reference.clone(),
                    "--property".into(),
                    "title".into(),
                ];
                if let Some(id) = &params.agent_id {
                    bounds_args.extend(["--agent-id".into(), id.clone()]);
                    title_args.extend(["--agent-id".into(), id.clone()]);
                }
                let (rectangle, title) = tokio::join!(
                    self.run(&bounds_args, None, Some(session.as_str())),
                    self.run(&title_args, None, Some(session.as_str()))
                );
                if let Ok(value) = rectangle {
                    bounds = value
                        .pointer("/data/value")
                        .cloned()
                        .and_then(|v| {
                            serde_json::from_value::<crate::cu_protocol::TargetBounds>(v).ok()
                        })
                        .filter(|b| b.valid());
                }
                if let Ok(title) = title {
                    label = title
                        .pointer("/data/value")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into();
                }
            }
            let (x, y) = bounds
                .map(|b| (b.x + b.width / 2.0, b.y + b.height / 2.0))
                .unwrap_or_else(crate::driver::pointer_position);
            let mut preview = crate::cu_protocol::ActionPreview::new(kind, x, y);
            preview.agent_id = params.agent_id.clone();
            preview.bounds = bounds;
            preview.label = label.chars().take(80).collect();
            if matches!(
                params.command,
                DesktopCommand::Type | DesktopCommand::SetValue
            ) {
                preview.text_length = params.text.as_ref().map(|text| text.chars().count());
            }
            // The GUI acknowledges a visible pre-action preview. If it fails,
            // stop here: do not silently perform an invisible action or retry.
            tokio::task::spawn_blocking(move || crate::driver::preview_action(preview))
                .await
                .map_err(|e| e.to_string())??;
        }
        self.run(&args, stdin.as_deref(), Some(session.as_str()))
            .await
    }

    async fn run(
        &self,
        args: &[String],
        input: Option<&str>,
        session: Option<&str>,
    ) -> Result<Value, String> {
        let binary = self.binary.as_ref()
            .filter(|p| p.is_absolute() && p.is_file())
            .ok_or("Bundled agent-desktop is unavailable. Open CC GUI → Settings → Computer Use. The built-in screenshot tools remain available.")?;
        let mut command = Command::new(&binary);
        command
            .args(args)
            .env("AGENT_DESKTOP_HOME", &self.home)
            .env_remove("AGENT_DESKTOP_SESSION")
            .env_remove("AGENT_DESKTOP_AGENT_ID")
            .env_remove("AGENT_DESKTOP_MACOS_HELPER_PATH")
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(session) = session {
            command.arg("--session").arg(session);
        }
        #[cfg(target_os = "macos")]
        {
            let arch = if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            };
            command.env(
                "AGENT_DESKTOP_MACOS_HELPER_PATH",
                binary.with_file_name(format!("agent-desktop-macos-helper-darwin-{arch}")),
            );
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Start bundled agent-desktop: {e}"))?;
        let stdout = child.stdout.take().ok_or("agent-desktop stdout missing")?;
        let stderr = child.stderr.take().ok_or("agent-desktop stderr missing")?;
        let mut pipe = child.stdin.take();
        let operation = async {
            let read_stdout = async {
                let mut bytes = Vec::new();
                stdout
                    .take(4 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .await?;
                Ok::<_, std::io::Error>(bytes)
            };
            let read_stderr = async {
                // Drain all stderr without retaining desktop content in errors.
                tokio::io::copy(&mut stderr.take(u64::MAX), &mut tokio::io::sink()).await?;
                Ok::<_, std::io::Error>(())
            };
            let write_input = async {
                if let (Some(pipe), Some(input)) = (&mut pipe, input) {
                    pipe.write_all(input.as_bytes()).await?;
                    pipe.shutdown().await?;
                }
                drop(pipe.take());
                Ok::<_, std::io::Error>(())
            };
            let (status, bytes, _, _) =
                tokio::try_join!(child.wait(), read_stdout, read_stderr, write_input)?;
            Ok::<_, std::io::Error>((status, bytes))
        };
        let result = tokio::time::timeout(self.timeout, operation).await;
        match result {
            Ok(Ok((status, bytes))) => {
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err(
                        "Desktop response is too large; inspect a smaller snapshot subtree".into(),
                    );
                }
                let value: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| format!("agent-desktop returned invalid JSON (exit {status}); action delivery may be uncertain, observe before retrying"))?;
                if !value.get("ok").is_some_and(Value::is_boolean) {
                    return Err("agent-desktop returned an unsupported JSON envelope".into());
                }
                // Preserve the entire upstream envelope, especially retry and
                // delivery dispositions; never automatically repeat a mutation.
                Ok(value)
            }
            other => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                Err(match other {
                    Err(_) => "agent-desktop timed out after 30 seconds; delivery is uncertain. Observe the app before retrying.".into(),
                    _ => "agent-desktop I/O failed; delivery is uncertain. Observe the app before retrying.".into(),
                })
            }
        }
    }
}

#[cfg(test)]
fn bounds_center(value: &Value) -> Option<(i32, i32)> {
    let bounds = value.pointer("/data/value")?;
    let x = bounds.get("x")?.as_f64()?;
    let y = bounds.get("y")?.as_f64()?;
    let w = bounds.get("width")?.as_f64()?;
    let h = bounds.get("height")?.as_f64()?;
    (x.is_finite() && y.is_finite() && w > 0.0 && h > 0.0)
        .then_some(((x + w / 2.0).round() as i32, (y + h / 2.0).round() as i32))
}

fn preview_kind(command: &DesktopCommand) -> Option<&'static str> {
    use DesktopCommand::*;
    Some(match command {
        Snapshot | Find | Get | ListApps | ListWindows => return None,
        Launch => "launch",
        Click => "click",
        DoubleClick => "double-click",
        RightClick => "right-click",
        Type => "type",
        SetValue => "set-value",
        Clear => "clear",
        Select => "select",
        Check => "check",
        Uncheck => "uncheck",
        Expand => "expand",
        Collapse => "collapse",
        ScrollTo => "scroll-to",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_arguments_cannot_override_session_or_run_other_commands() {
        assert!(
            serde_json::from_value::<DesktopParams>(serde_json::json!({"command":"sandbox"}))
                .is_err()
        );
        assert!(serde_json::from_value::<DesktopParams>(
            serde_json::json!({"command":"snapshot","args":["--session","other"]})
        )
        .is_err());
        let params: DesktopParams =
            serde_json::from_value(serde_json::json!({"command":"click","ref":"--help"})).unwrap();
        assert!(params.arguments().is_err());
    }
    #[test]
    fn text_stays_off_process_arguments_and_preserves_newlines() {
        let params: DesktopParams = serde_json::from_value(
            serde_json::json!({"command":"set-value","ref":"@s1:e2","text":"hello\n$()"}),
        )
        .unwrap();
        let (args, stdin) = params.arguments().unwrap();
        assert_eq!(args, ["set-value", "@s1:e2", "--stdin"]);
        assert_eq!(stdin.as_deref(), Some("hello\n$()"));
    }
    #[test]
    fn bounds_are_screen_coordinates_without_screenshot_scaling() {
        assert_eq!(
            bounds_center(
                &serde_json::json!({"data":{"value":{"x":-100.0,"y":20.0,"width":40.0,"height":20.0}}})
            ),
            Some((-80, 30))
        );
    }

    #[cfg(unix)]
    fn fixture(script: &str) -> AgentDesktop {
        use std::os::unix::fs::PermissionsExt;
        let mut desktop = AgentDesktop::default();
        let binary = desktop.home.with_extension("sh");
        std::fs::write(&binary, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        desktop.binary = Some(binary);
        desktop
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn session_is_lazy_shared_and_cleaned_and_unsafe_errors_are_not_retried() {
        let desktop = fixture(
            r#"
printf '%s\n' "$1" >> "$AGENT_DESKTOP_HOME/calls"
case "$1" in
  session) printf '%s' '{"ok":true,"data":{"session_id":"test-session"}}' ;;
  get) printf '%s' '{"ok":true,"data":{"value":{"x":10,"y":20,"width":40,"height":20}}}' ;;
  click) printf '%s' '{"ok":false,"error":{"code":"APP_UNRESPONSIVE","disposition":{"delivery":"delivery_uncertain","retry":"unsafe"}}}'; exit 1 ;;
  snapshot) printf '%s' '{"ok":true,"data":{"snapshot_id":"test"}}' ;;
esac
"#,
        );
        let home = desktop.home.clone();
        let binary = desktop.binary.clone().unwrap();
        assert!(
            !home.exists(),
            "constructing the server must not start a session"
        );
        let snapshot =
            || serde_json::from_value(serde_json::json!({"command":"snapshot"})).unwrap();
        let (a, b) = tokio::join!(desktop.execute(snapshot()), desktop.execute(snapshot()));
        assert!(a.unwrap()["ok"].as_bool().unwrap());
        assert!(b.unwrap()["ok"].as_bool().unwrap());
        let click = serde_json::from_value(serde_json::json!({"command":"click","ref":"@test:e1"}))
            .unwrap();
        let result = desktop.execute(click).await.unwrap();
        assert_eq!(result["error"]["disposition"]["retry"], "unsafe");
        let calls = std::fs::read_to_string(home.join("calls")).unwrap();
        assert_eq!(calls.lines().filter(|s| *s == "session").count(), 1);
        assert_eq!(calls.lines().filter(|s| *s == "click").count(), 1);
        drop(desktop);
        assert!(
            !home.exists(),
            "closing the MCP owner must delete private refmaps"
        );
        std::fs::remove_file(binary).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn independent_workers_overlap_and_keep_their_native_namespaces() {
        let desktop = fixture(
            r#"
if [ "$1" = session ]; then
  printf '%s' '{"ok":true,"data":{"session_id":"shared"}}'
  exit 0
fi
worker=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --agent-id ]; then shift; worker="$1"; fi
  shift
done
touch "$AGENT_DESKTOP_HOME/$worker.started"
i=0
while [ ! -f "$AGENT_DESKTOP_HOME/agent-1.started" ] || [ ! -f "$AGENT_DESKTOP_HOME/agent-2.started" ]; do
  i=$((i+1))
  if [ "$i" -gt 100 ]; then printf '%s' '{"ok":false,"error":"workers serialized"}'; exit 1; fi
  sleep 0.01
done
printf '{"ok":true,"data":{"worker":"%s"}}' "$worker"
"#,
        );
        *desktop.team.lock().await = true;
        let params = |id| {
            serde_json::from_value(serde_json::json!({"command":"snapshot","agent_id":id})).unwrap()
        };
        let (a, b) = tokio::join!(
            desktop.execute(params("agent-1")),
            desktop.execute(params("agent-2"))
        );
        assert_eq!(a.unwrap()["data"]["worker"], "agent-1");
        assert_eq!(b.unwrap()["data"]["worker"], "agent-2");
        std::fs::remove_file(desktop.binary.as_ref().unwrap()).unwrap();
    }

    #[tokio::test]
    async fn unknown_or_unprepared_workers_never_start_a_process() {
        let desktop = AgentDesktop::default();
        for id in ["agent-1", "agent-4", "--help", "agent-1/../../other"] {
            let params =
                serde_json::from_value(serde_json::json!({"command":"snapshot","agent_id":id}))
                    .unwrap();
            assert!(desktop.execute(params).await.is_err());
        }
        assert!(!desktop.home.exists());
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "launched in a separate OS process by delegated_processes_share_one_team"]
    fn delegated_process_worker() {
        let team = std::env::var("CCGUI_TEST_TEAM").expect("test parent capability");
        let worker = std::env::var("CCGUI_TEST_WORKER").unwrap();
        let physical = std::env::var_os("CCGUI_TEST_EXCLUSIVE").is_some();
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let desktop = AgentDesktop::default();
            let params = serde_json::from_value(serde_json::json!({"command":"snapshot","team_id":team,"agent_id":worker,"physical":physical})).unwrap();
            let result = desktop.execute(params).await.unwrap();
            assert_eq!(result["data"]["worker"], worker, "{result}");
            assert_eq!(result["data"]["session"], "shared-session", "{result}");
            assert!(desktop.borrows_team(), "worker EOF must not hide its parent's cursors");
        });
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn delegated_processes_share_one_team() {
        let desktop = fixture(
            r#"
if [ "$1" = session ]; then
  printf 'session\n' >> "$AGENT_DESKTOP_HOME/initializations"
  printf '%s' '{"ok":true,"data":{"session_id":"shared-session"}}'
  exit 0
fi
worker=""; session=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-id) shift; worker="$1";;
    --session) shift; session="$1";;
  esac
  shift
done
if [ -n "$CCGUI_TEST_EXCLUSIVE" ]; then
  if ! mkdir "$AGENT_DESKTOP_HOME/physical-active" 2>/dev/null; then
    printf '%s' '{"ok":false,"error":"physical input overlapped"}'; exit 1
  fi
  sleep 0.05
  rmdir "$AGENT_DESKTOP_HOME/physical-active"
else
  touch "$AGENT_DESKTOP_HOME/$worker.started"
  i=0
  while [ ! -f "$AGENT_DESKTOP_HOME/agent-1.started" ] || [ ! -f "$AGENT_DESKTOP_HOME/agent-2.started" ] || [ ! -f "$AGENT_DESKTOP_HOME/agent-3.started" ]; do
    i=$((i+1)); if [ "$i" -gt 200 ]; then printf '%s' '{"ok":false,"error":"workers serialized"}'; exit 1; fi
    sleep 0.01
  done
fi
printf '{"ok":true,"data":{"worker":"%s","session":"%s"}}' "$worker" "$session"
"#,
        );
        let team = desktop.prepare_team().await.unwrap();
        for exclusive in [false, true] {
            let children: Vec<_> = (1..=3)
                .map(|n| {
                    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
                    command
                        .args([
                            "--exact",
                            "agent_desktop::tests::delegated_process_worker",
                            "--ignored",
                            "--nocapture",
                        ])
                        .env("CCGUI_TEST_TEAM", team["team_id"].as_str().unwrap())
                        .env("CCGUI_TEST_WORKER", format!("agent-{n}"))
                        .env("CCGUI_AGENT_DESKTOP_BIN", desktop.binary.as_ref().unwrap())
                        .env_remove("CCGUI_TEST_EXCLUSIVE")
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());
                    if exclusive {
                        command.env("CCGUI_TEST_EXCLUSIVE", "1");
                    }
                    command.spawn().unwrap()
                })
                .collect();
            for child in children {
                let output = child.wait_with_output().unwrap();
                assert!(
                    output.status.success(),
                    "{} {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            assert!(
                desktop.home.is_dir(),
                "borrower exit must preserve owner state"
            );
        }
        assert_eq!(
            std::fs::read_to_string(desktop.home.join("initializations")).unwrap(),
            "session\n"
        );
        let script = desktop.binary.clone().unwrap();
        let home = desktop.home.clone();
        drop(desktop);
        assert!(
            !home.exists(),
            "owner exit revokes and removes the shared team"
        );
        std::fs::remove_file(script).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn team_capability_is_isolated_and_expires_with_its_owner() {
        let owner = fixture(r#"printf '%s' '{"ok":true,"data":{"session_id":"team-session"}}'"#);
        let prepared = owner.prepare_team().await.unwrap();
        let state_path = owner.home.join("team-session.json");
        let saved_state = std::fs::read(&state_path).unwrap();
        let mut state: Value = serde_json::from_slice(&saved_state).unwrap();
        state["binding"] = Value::String("another-gui".into());
        std::fs::write(&state_path, serde_json::to_vec(&state).unwrap()).unwrap();
        let rejected = AgentDesktop::default();
        let foreign = serde_json::from_value(serde_json::json!({"command":"snapshot","agent_id":"agent-1","team_id":prepared["team_id"]})).unwrap();
        assert!(rejected
            .execute(foreign)
            .await
            .unwrap_err()
            .contains("another CC GUI instance"));
        std::fs::write(&state_path, saved_state).unwrap();
        let borrower = AgentDesktop::default();
        let params = || {
            serde_json::from_value(serde_json::json!({"command":"snapshot","agent_id":"agent-1","team_id":prepared["team_id"]})).unwrap()
        };
        // A borrowed context uses the caller's bundled binary, not a path in shared metadata.
        let mut borrower = borrower;
        borrower.binary = owner.binary.clone();
        assert!(borrower.execute(params()).await.unwrap()["ok"]
            .as_bool()
            .unwrap());
        let other: DesktopParams = serde_json::from_value(serde_json::json!({"command":"snapshot","agent_id":"agent-1","team_id":uuid::Uuid::new_v4().to_string()})).unwrap();
        assert!(borrower.execute(other).await.is_err());
        let script = owner.binary.clone().unwrap();
        drop(owner);
        assert!(
            borrower.execute(params()).await.is_err(),
            "expired capabilities cannot restart the session"
        );
        std::fs::remove_file(script).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_reaps_the_owned_process_and_reports_uncertain_delivery() {
        let mut desktop = fixture("exec /bin/sleep 10");
        desktop.timeout = Duration::from_millis(50);
        let binary = desktop.binary.clone().unwrap();
        let start = std::time::Instant::now();
        let error = desktop
            .run(&["click".into()], None, None)
            .await
            .unwrap_err();
        assert!(error.contains("delivery is uncertain"));
        assert!(start.elapsed() < Duration::from_secs(2));
        std::fs::remove_file(binary).unwrap();
    }
}
