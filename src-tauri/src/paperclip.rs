//! Local Paperclip integration. Credentials stay in the existing consent-gated
//! limits module or Paperclip managed connections; no remote
//! UI is loaded into an IPC-capable webview. Native API calls are deliberately
//! limited to the board operations below; service control is desktop-only.
pub mod service;
mod activity;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};

const AVATAR_PALETTES: &[&str] = &["bubblegum-sky", "pink-lemonade", "orchid-peach", "coral-mint", "lime-lagoon", "arctic-blue", "solar-flare", "violet-ember", "deep-tide", "coral-current", "golden-hour", "tangerine-cobalt", "electric-grove", "flamingo-jade", "cherry-pop", "turquoise-cherry", "ultraviolet-tide"];
static AVATAR_CACHE: std::sync::LazyLock<parking_lot::Mutex<std::collections::VecDeque<(String, String)>>> = std::sync::LazyLock::new(|| parking_lot::Mutex::new(std::collections::VecDeque::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperclipConfig {
    pub port: u16,
    pub source_dir: String,
    pub data_dir: String,
    pub node_path: String,
    pub pnpm_path: String,
    pub keep_awake: bool,
}

pub(crate) fn directory() -> PathBuf {
    crate::paths::app_home().join("paperclip")
}

fn defaults() -> PaperclipConfig {
    let home = crate::paths::home_dir();
    let source = [home.join("Desktop/Projects/paperclip"), home.join("Projects/paperclip")]
        .into_iter().find(|p| p.join("server/package.json").is_file());
    let data = source.as_ref().map(|p| p.join(".paperclip-local/data"))
        .filter(|p| p.is_dir()).unwrap_or_else(|| home.join(".paperclip"));
    let node = [home.join(".local/share/paperclip-runtime/node_modules/node/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"), PathBuf::from("/usr/local/bin/node")]
        .into_iter().find(|p| p.is_file());
    let pnpm = [PathBuf::from("/opt/homebrew/bin/pnpm"), PathBuf::from("/usr/local/bin/pnpm"), home.join("Library/pnpm/pnpm.cjs")]
        .into_iter().find(|p| p.is_file());
    PaperclipConfig {
        port: 3100,
        source_dir: source.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        data_dir: data.to_string_lossy().into_owned(),
        node_path: node.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        pnpm_path: pnpm.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        keep_awake: false,
    }
}

pub(crate) fn load_config() -> Result<PaperclipConfig, String> {
    match std::fs::read(directory().join("config.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Paperclip configuration: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(defaults()),
        Err(e) => Err(format!("Cannot read Paperclip configuration: {e}")),
    }
}

pub(crate) fn write_private(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Missing configuration directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".paperclip-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(temp); }
    result
}

pub(crate) fn save_config(config: &PaperclipConfig) -> Result<(), String> {
    if config.port == 0 { return Err("Paperclip port must be between 1 and 65535".into()); }
    write_private(&directory().join("config.json"), &serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(25))
        .build().map_err(|e| e.to_string())
}

async fn request(port: u16, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut req = client()?.request(method, format!("http://127.0.0.1:{port}/api/{path}"))
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = body { req = req.json(&body); }
    let response = req.send().await.map_err(|e| format!("Cannot reach Paperclip on port {port}: {e}"))?;
    response_json(response).await
}

async fn response_json(mut response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 { return Err("Paperclip response exceeds 8 MiB".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("Paperclip returned a non-JSON response (HTTP {status})"))?;
    if !status.is_success() {
        let message = value.get("error").and_then(Value::as_str).unwrap_or("Request rejected");
        return Err(format!("Paperclip HTTP {status}: {}", message.chars().take(500).collect::<String>()));
    }
    Ok(value)
}

#[tauri::command]
pub async fn paperclip_config() -> Result<Value, String> {
    Ok(json!({ "config": load_config()?, "configured": directory().join("config.json").is_file(), "service": service::status()? }))
}

#[tauri::command]
pub async fn paperclip_connect(config: PaperclipConfig) -> Result<Value, String> {
    if config.port == 0 { return Err("Invalid port".into()); }
    let health = request(config.port, reqwest::Method::GET, "health", None).await?;
    if health.get("status").and_then(Value::as_str) != Some("ok") {
        return Err("Paperclip is not ready".into());
    }
    if health.get("deploymentMode").and_then(Value::as_str) != Some("local_trusted") {
        return Err("This integration requires a local_trusted Paperclip instance. Open the full Paperclip interface to use authenticated instances.".into());
    }
    save_config(&config)?;
    Ok(health)
}

fn route(action: &str, id: Option<&str>) -> Result<(reqwest::Method, String), String> {
    use reqwest::Method;
    if action == "companies" { return Ok((Method::GET, "companies".into())); }
    let id = id.filter(|id| !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'))
        .ok_or("Invalid Paperclip resource ID")?;
    let (method, path) = match action {
        "agents" => (Method::GET, format!("companies/{id}/agents")),
        "projects" => (Method::GET, format!("companies/{id}/projects")),
        "goals" => (Method::GET, format!("companies/{id}/goals")),
        "approvals" => (Method::GET, format!("companies/{id}/approvals")),
        "routines" => (Method::GET, format!("companies/{id}/routines")),
        "routine" => (Method::GET, format!("routines/{id}")),
        "costByAgent" => (Method::GET, format!("companies/{id}/costs/by-agent")),
        "quotaWindows" => (Method::GET, format!("companies/{id}/costs/quota-windows")),
        "usageRuns" => (Method::GET, format!("companies/{id}/heartbeat-runs?limit=100&summary=true")),
        "budgets" => (Method::GET, format!("companies/{id}/budgets/overview")),
        "agentConfiguration" => (Method::GET, format!("agents/{id}/configuration")),
        "agentInstructions" => (Method::GET, format!("agents/{id}/instructions-bundle")),
        "agentInstructionFile" => (Method::GET, format!("agents/{id}/instructions-bundle/file")),
        "saveAgentInstructions" => (Method::PUT, format!("agents/{id}/instructions-bundle/file")),
        "createAgent" => (Method::POST, format!("companies/{id}/agents")),
        "updateAgent" => (Method::PATCH, format!("agents/{id}")),
        "createProject" => (Method::POST, format!("companies/{id}/projects")),
        "updateProject" => (Method::PATCH, format!("projects/{id}")),
        "createGoal" => (Method::POST, format!("companies/{id}/goals")),
        "updateGoal" => (Method::PATCH, format!("goals/{id}")),
        "approve" => (Method::POST, format!("approvals/{id}/approve")),
        "reject" => (Method::POST, format!("approvals/{id}/reject")),
        "requestRevision" => (Method::POST, format!("approvals/{id}/request-revision")),
        "createRoutine" => (Method::POST, format!("companies/{id}/routines")),
        "updateRoutine" => (Method::PATCH, format!("routines/{id}")),
        "runRoutine" => (Method::POST, format!("routines/{id}/run")),
        "createSchedule" => (Method::POST, format!("routines/{id}/triggers")),
        "updateSchedule" => (Method::PATCH, format!("routine-triggers/{id}")),
        "saveBudget" => (Method::POST, format!("companies/{id}/budgets/policies")),
        "issues" => (Method::GET, format!("companies/{id}/issues?limit=200&view=compact")),
        "runs" => (Method::GET, format!("companies/{id}/heartbeat-runs?limit=30&summary=true")),
        "dashboard" => (Method::GET, format!("companies/{id}/dashboard")),
        "issueLiveRuns" => (Method::GET, format!("issues/{id}/live-runs")),
        "issueExecution" => (Method::GET, format!("issues/{id}/execution")),
        "runStatus" => (Method::GET, format!("heartbeat-runs/{id}")),
        "runEvents" => (Method::GET, format!("heartbeat-runs/{id}/events")),
        "issue" => (Method::GET, format!("issues/{id}?view=core")),
        "attachments" => (Method::GET, format!("issues/{id}/attachments")),
        "comments" => (Method::GET, format!("issues/{id}/comments?limit=50&order=desc")),
        "pauseAgent" => (Method::POST, format!("agents/{id}/pause")),
        "resumeAgent" => (Method::POST, format!("agents/{id}/resume")),
        "wakeAgent" => (Method::POST, format!("agents/{id}/heartbeat/invoke")),
        "stopRun" => (Method::POST, format!("heartbeat-runs/{id}/cancel")),
        "createIssue" => (Method::POST, format!("companies/{id}/issues")),
        "updateIssue" => (Method::PATCH, format!("issues/{id}")),
        "comment" => (Method::POST, format!("issues/{id}/comments")),
        _ => return Err("Unsupported Paperclip action".into()),
    };
    Ok((method, path))
}

const ATTACHMENT_LIMIT: usize = 10 * 1024 * 1024;

#[tauri::command]
pub async fn paperclip_attachment_file(db: tauri::State<'_, std::sync::Arc<crate::db::Db>>, path: String) -> Result<Value, String> {
    use base64::Engine;
    use std::io::Read;
    let allowed = crate::files::ensure_allowed(&path, &db)?;
    // This document picker is not a CLI credential access / consent surface.
    let normalized = allowed.to_string_lossy().replace('\\', "/");
    if normalized.ends_with("/.codex/auth.json") || normalized.ends_with("/.claude/.credentials.json") {
        return Err("CLI credential files cannot be used as task attachments".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&allowed).map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("Attachment must be a file".into()); }
        let mut bytes = Vec::new();
        file.take((ATTACHMENT_LIMIT + 1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.is_empty() || bytes.len() > ATTACHMENT_LIMIT { return Err("Attachment must be between 1 byte and 10 MiB".into()); }
        Ok(json!({ "name": allowed.file_name().unwrap_or_default().to_string_lossy(), "base64": base64::engine::general_purpose::STANDARD.encode(bytes) }))
    }).await.map_err(|e| e.to_string())?
}

fn attachment_part(body: &Value) -> Result<reqwest::multipart::Part, String> {
    use base64::Engine;
    let name = body["name"].as_str().filter(|v| !v.is_empty() && v.len() <= 255 && !v.contains(['\r', '\n', '\0', '/', '\\'])).ok_or("Invalid attachment filename")?;
    let encoded = body["base64"].as_str().filter(|v| v.len() <= (ATTACHMENT_LIMIT + 2) / 3 * 4).ok_or("Attachment exceeds 10 MiB")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Invalid attachment encoding")?;
    if bytes.is_empty() || bytes.len() > ATTACHMENT_LIMIT { return Err("Attachment must be between 1 byte and 10 MiB".into()); }
    let mime = body["contentType"].as_str().unwrap_or("application/octet-stream");
    reqwest::multipart::Part::bytes(bytes).file_name(name.to_owned()).mime_str(mime).map_err(|_| "Invalid attachment content type".to_string())
}

async fn upload_attachment(issue_id: Option<&str>, body: Option<&Value>) -> Result<Value, String> {
    let body = body.ok_or("Missing attachment")?;
    let (_, issue_path) = route("issue", issue_id)?;
    let company = body["companyId"].as_str().ok_or("Missing company")?;
    route("projects", Some(company))?;
    let port = load_config()?.port;
    if body["expectedPort"].as_u64() != Some(port as u64) { return Err("Paperclip connection changed".into()); }
    let part = attachment_part(body)?;
    // Validate ownership before transmitting the file body.
    let issue = request(port, reqwest::Method::GET, &issue_path, None).await?;
    if issue["companyId"].as_str() != Some(company) { return Err("Issue does not belong to company".into()); }
    let form = reqwest::multipart::Form::new().part("file", part);
    let id = issue_id.ok_or("Missing issue")?;
    let response = client()?.post(format!("http://127.0.0.1:{port}/api/companies/{company}/issues/{id}/attachments")).multipart(form).send().await.map_err(|e| e.to_string())?;
    response_json(response).await
}

/// Read-only local Codex lookup; the existing consent gate remains the only
/// path to CLI credentials. Called only by an explicit desktop action.
#[tauri::command]
pub async fn paperclip_codex_limits() -> Result<crate::usage_limits::LimitsResponse, String> {
    crate::usage_limits::get(Some(vec!["codex".into()]), true).await
}

fn usage_query(action: &str, path: &mut String, body: Option<&Value>) -> Result<(), String> {
    let Some(body) = body else { return Ok(()); };
    let mut query = reqwest::Url::parse("http://127.0.0.1/").map_err(|e| e.to_string())?;
    if action == "costByAgent" {
        let from = body.get("from").and_then(Value::as_str).ok_or("Missing usage period start")?;
        let to = body.get("to").and_then(Value::as_str).ok_or("Missing usage period end")?;
        let start = chrono::DateTime::parse_from_rfc3339(from).map_err(|_| "Invalid usage period start")?;
        let end = chrono::DateTime::parse_from_rfc3339(to).map_err(|_| "Invalid usage period end")?;
        if start > end || end.signed_duration_since(start).num_days() > 3700 { return Err("Invalid usage period range".into()); }
        query.query_pairs_mut().append_pair("from", from).append_pair("to", to);
    } else if action == "usageRuns" {
        if let Some(id) = body.get("agentId").and_then(Value::as_str) {
            route("agents", Some(id))?; // Resource IDs never become arbitrary query syntax.
            query.query_pairs_mut().append_pair("agentId", id);
        }
    } else { return Ok(()); }
    if let Some(query) = query.query() { path.push(if path.contains('?') { '&' } else { '?' }); path.push_str(query); }
    Ok(())
}

#[tauri::command]
pub async fn paperclip_request(action: String, id: Option<String>, body: Option<Value>) -> Result<Value, String> {
    if action == "uploadAttachment" { return upload_attachment(id.as_deref(), body.as_ref()).await; }
    let (method, mut path) = route(&action, id.as_deref())?;
    usage_query(&action, &mut path, body.as_ref())?;
    let after_seq = if action == "runEvents" {
        let seq = body.as_ref().and_then(|v| v.get("afterSeq")).map(|v| v.as_u64().filter(|n| *n <= 9_007_199_254_740_991).ok_or("Invalid event cursor")).transpose()?.unwrap_or(0);
        path.push_str(&format!("?afterSeq={seq}&limit=200")); seq
    } else { 0 };
    if body.as_ref().is_some_and(|v| v.to_string().len() > 64 * 1024) {
        return Err("Paperclip request exceeds 64 KiB".into());
    }
    // Schedule creation never returns webhook credentials to the host UI.
    if action == "createSchedule" && body.as_ref().and_then(|v| v.get("kind")).and_then(Value::as_str) != Some("schedule") {
        return Err("Only scheduled routine triggers are supported here".into());
    }
    if action == "agentInstructionFile" || action == "saveAgentInstructions" {
        let file = body.as_ref().and_then(|v| v.get("path")).and_then(Value::as_str).ok_or("Missing instruction file path")?;
        if file.is_empty() || file.len() > 512 || file.starts_with('/') || file.contains('\\') || file.contains('\0') || file.split('/').any(|part| part == "..") || ![".md", ".txt"].iter().any(|suffix| file.to_ascii_lowercase().ends_with(suffix)) {
            return Err("Instruction path must be relative to the agent's instruction bundle".into());
        }
        let (_, bundle_path) = route("agentInstructions", id.as_deref())?;
        let bundle = request(load_config()?.port, reqwest::Method::GET, &bundle_path, None).await?;
        if bundle["mode"] != "managed" || bundle["entryFile"].as_str() != Some(file) {
            return Err("Only the managed entry instruction file can be edited here. Use Paperclip for external instruction locations.".into());
        }
        if action == "agentInstructionFile" {
            let mut query = reqwest::Url::parse("http://127.0.0.1/").map_err(|e| e.to_string())?;
            query.query_pairs_mut().append_pair("path", file);
            path.push('?'); path.push_str(query.query().unwrap_or_default());
        }
    }
    let port = load_config()?.port;
    let mut body = if method == reqwest::Method::GET { None } else { Some(body.unwrap_or_else(|| json!({}))) };
    if action == "updateAgent" {
        if let Some(patch) = body.as_mut().and_then(Value::as_object_mut) {
            if let Some(runtime_patch) = patch.remove("runtimeConfig") {
                let (_, configuration_path) = route("agentConfiguration", id.as_deref())?;
                let current = request(port, reqwest::Method::GET, &configuration_path, None).await?;
                patch.insert("runtimeConfig".into(), merge_runtime(current.get("runtimeConfig"), runtime_patch));
            }
        }
    }
    let value = request(port, method, &path, body).await?;
    if action == "runEvents" { return Ok(activity::events(value, after_seq)); }
    if action == "runStatus" { return Ok(activity::run(value)); }
    if action == "issueLiveRuns" { return Ok(Value::Array(value.as_array().cloned().unwrap_or_default().into_iter().map(activity::run).collect())); }
    if action == "issueExecution" { return Ok(if value.is_null() { Value::Null } else { json!({"runId":value["runId"],"agentId":value["agentId"]}) }); }
    Ok(if action == "agentConfiguration" { editable_configuration(value) } else if action == "usageRuns" { usage_runs(value) } else { value })
}

fn usage_runs(value: Value) -> Value {
    match value {
        Value::Array(rows) => Value::Array(rows.into_iter().map(|mut row| {
            if let Some(fields) = row.as_object_mut() {
                fields.retain(|key, _| ["id", "agentId", "status", "createdAt", "startedAt", "finishedAt", "costUsd", "usageJson", "inputTokens", "cachedInputTokens", "outputTokens"].contains(&key.as_str()));
                if let Some(usage) = fields.get_mut("usageJson").and_then(Value::as_object_mut) {
                    usage.retain(|key, _| ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"].contains(&key.as_str()));
                }
            }
            row
        }).collect()),
        value => value,
    }
}

fn editable_configuration(mut value: Value) -> Value {
    if let Some(row) = value.as_object_mut() {
        row.retain(|key, _| ["id", "name", "role", "title", "reportsTo", "capabilities", "adapterType", "adapterConfig", "runtimeConfig", "configurationRevision", "budgetMonthlyCents"].contains(&key.as_str()));
        // Editing a model must not round-trip redacted environment values,
        // connection bindings, secrets or unrelated runtime configuration.
        if let Some(config) = value.get_mut("adapterConfig").and_then(Value::as_object_mut) {
            config.retain(|key, _| ["model", "cwd", "thinkingEffort", "maxTurnsPerRun"].contains(&key.as_str()));
        }
        if let Some(config) = value.get_mut("runtimeConfig").and_then(Value::as_object_mut) {
            config.retain(|key, _| key == "heartbeat");
        }
    }
    value
}

fn merge_runtime(current: Option<&Value>, patch: Value) -> Value {
    let mut result = current.and_then(Value::as_object).cloned().unwrap_or_default();
    if let Value::Object(patch) = patch {
        for (key, value) in patch {
            if key == "heartbeat" {
                let mut heartbeat = result.get(&key).and_then(Value::as_object).cloned().unwrap_or_default();
                if let Value::Object(fields) = value { heartbeat.extend(fields); }
                result.insert(key, Value::Object(heartbeat));
            } else { result.insert(key, value); }
        }
    }
    Value::Object(result)
}

fn avatar_path(palette: Option<&str>, asset_id: Option<&str>) -> Result<String, String> {
    match (palette, asset_id) {
        (None, Some(id)) => {
            let id = uuid::Uuid::parse_str(id).map_err(|_| "Invalid avatar asset ID")?;
            Ok(format!("assets/{id}/content"))
        }
        (Some(palette), None) if AVATAR_PALETTES.contains(&palette) =>
            Ok(format!("agent-avatars/cap-v1/{palette}/rest.png?size=96&scale=2")),
        _ => Err("Choose a supported avatar palette or a single avatar asset".into()),
    }
}

fn avatar_data_url(bytes: Vec<u8>) -> Result<String, String> {
    use base64::Engine;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| "Unsupported avatar image")?.thumbnail(192, 192);
    let mut output = std::io::Cursor::new(Vec::new());
    decoded.write_to(&mut output, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(output.into_inner())))
}

/// Image-only bridge to the configured loopback Paperclip. Never accepts a URL,
/// follows redirects, loads SVG/HTML, or expands the webview's network policy.
#[tauri::command]
pub async fn paperclip_avatar(palette: Option<String>, asset_id: Option<String>, expected_port: u16) -> Result<String, String> {
    let path = avatar_path(palette.as_deref(), asset_id.as_deref())?;
    let port = load_config()?.port;
    if port != expected_port { return Err("Paperclip connection changed while the avatar was queued".into()); }
    let key = format!("{port}:{path}");
    if let Some((_, image)) = AVATAR_CACHE.lock().iter().find(|(id, _)| id == &key) { return Ok(image.clone()); }
    let mut response = client()?.get(format!("http://127.0.0.1:{port}/api/{path}")).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Avatar unavailable: HTTP {}", response.status())); }
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim();
    if !["image/png", "image/jpeg", "image/webp"].contains(&mime) { return Err("Avatar response is not a supported raster image".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 { return Err("Avatar exceeds 4 MiB".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let data = tauri::async_runtime::spawn_blocking(move || avatar_data_url(bytes)).await.map_err(|e| e.to_string())??;
    let mut cache = AVATAR_CACHE.lock();
    cache.push_back((key, data.clone()));
    while cache.len() > 128 { cache.pop_front(); }
    Ok(data)
}

#[tauri::command]
pub async fn paperclip_service(action: String, config: Option<PaperclipConfig>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "status" => service::status(),
        "start" => service::install(config.ok_or("Missing service configuration")?),
        "stop" => service::uninstall(),
        _ => Err("Unsupported service action".into()),
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_payload_rejects_paths_header_injection_empty_and_oversized_data() {
        for name in ["../auth.json", "folder/file.txt", "file\r\nInjected: yes", "", "folder\\file.txt"] {
            assert!(attachment_part(&json!({"name":name,"base64":"YQ==","contentType":"text/plain"})).is_err());
        }
        for data in ["".to_string(), "not-base64".to_string(), "A".repeat((ATTACHMENT_LIMIT + 2) / 3 * 4 + 1)] {
            assert!(attachment_part(&json!({"name":"file.txt","base64":data})).is_err());
        }
        assert!(attachment_part(&json!({"name":"контекст.txt","base64":"YQ==","contentType":"text/plain"})).is_ok());
    }

    #[tokio::test]
    async fn activity_event_cursors_reject_invalid_values_before_network() {
        for cursor in [json!(-1), json!(1.5), json!("0&other=true"), json!(9_007_199_254_740_992_u64)] {
            let error = paperclip_request("runEvents".into(), Some("run-id".into()), Some(json!({"afterSeq":cursor}))).await.unwrap_err();
            assert!(error.contains("Invalid event cursor"));
        }
    }

    #[test]
    fn usage_reads_reject_query_injection_and_strip_private_run_payloads() {
        let mut path = route("costByAgent", Some("company")).unwrap().1;
        usage_query("costByAgent", &mut path, Some(&json!({"from":"2026-11-01T00:00:00Z","to":"2026-11-17T00:00:00Z"}))).unwrap();
        assert!(path.contains("from=2026-11-01"));
        assert!(usage_query("costByAgent", &mut String::new(), Some(&json!({"from":"&secret=true","to":"2026-11-17T00:00:00Z"}))).is_err());
        assert!(usage_query("costByAgent", &mut String::new(), Some(&json!({"from":"2026-12-01T00:00:00Z","to":"2026-11-17T00:00:00Z"}))).is_err());
        assert!(usage_query("usageRuns", &mut String::new(), Some(&json!({"agentId":"agent&limit=99999"}))).is_err());
        let projected = usage_runs(json!([{"id":"run","inputTokens":12,"costUsd":null,"contextSnapshot":{"prompt":"private"},"stdoutExcerpt":"private","resultJson":{"secret":"private"},"usageJson":{"outputTokens":5,"ledgerScope":{"private":true}}}]));
        assert_eq!(projected[0]["inputTokens"], 12);
        assert_eq!(projected[0]["usageJson"], json!({"outputTokens":5}));
        assert!(projected[0].get("stdoutExcerpt").is_none());
        assert!(projected[0].get("contextSnapshot").is_none());
        assert!(projected[0].get("resultJson").is_none());
    }

    #[test]
    fn routes_reject_paths_urls_and_unknown_operations() {
        for id in ["../settings", "a?b=c", "a/b", "http://localhost", "", "%2e%2e"] {
            assert!(route("issue", Some(id)).is_err(), "{id}");
        }
        assert!(route("deleteEverything", Some("valid-id")).is_err());
        assert_eq!(route("stopRun", Some("run-123")).unwrap().1, "heartbeat-runs/run-123/cancel");
        assert!(route("companies", None).is_ok());
    }
    #[test]
    fn management_routes_use_only_known_resource_operations() {
        for action in ["goals", "approvals", "routines", "routine", "budgets", "agentConfiguration", "agentInstructions"] {
            assert_eq!(route(action, Some("resource-id")).unwrap().0, reqwest::Method::GET);
        }
        assert_eq!(route("saveBudget", Some("company-id")).unwrap().1, "companies/company-id/budgets/policies");
        assert_eq!(route("updateSchedule", Some("trigger-id")).unwrap().1, "routine-triggers/trigger-id");
        assert_eq!(route("saveAgentInstructions", Some("agent-id")).unwrap().0, reqwest::Method::PUT);
        assert!(route("rotateSecret", Some("agent-id")).is_err());
    }
    #[test]
    fn avatar_paths_accept_only_fixed_presets_or_uuid_assets() {
        assert!(avatar_path(Some("pink-lemonade"), None).unwrap().starts_with("agent-avatars/cap-v1/"));
        for palette in ["../auth.json", "https://example.com/image.png", "unknown", "pink-lemonade?file=auth"] {
            assert!(avatar_path(Some(palette), None).is_err());
        }
        assert!(avatar_path(None, Some("../../auth.json")).is_err());
        assert!(avatar_path(Some("pink-lemonade"), Some("d59fc931-491b-4e7e-b225-9d69dbfe299b")).is_err());
        assert!(avatar_path(None, Some("d59fc931-491b-4e7e-b225-9d69dbfe299b")).unwrap().starts_with("assets/"));
    }
    #[test]
    fn avatars_are_normalized_to_bounded_png_and_markup_is_rejected() {
        use base64::Engine;
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(256, 128).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let data = avatar_data_url(bytes.into_inner()).unwrap();
        let encoded = data.strip_prefix("data:image/png;base64,").unwrap();
        let png = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert!(decoded.width() <= 192 && decoded.height() <= 192);
        assert!(avatar_data_url(b"<svg onload='alert(1)'/>".to_vec()).is_err());
        let mut oversized = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2049, 1).write_to(&mut oversized, image::ImageFormat::Png).unwrap();
        assert!(avatar_data_url(oversized.into_inner()).is_err());
    }
    #[test]
    fn heartbeat_updates_preserve_existing_connection_and_runtime_fields() {
        let existing = json!({"aiConnection":{"connectionId":"existing"},"debug":{"providerTrace":"raw"},"heartbeat":{"enabled":false,"intervalSec":300,"wakeOnDemand":true}});
        let merged = merge_runtime(Some(&existing), json!({"heartbeat":{"enabled":true,"intervalSec":600}}));
        assert_eq!(merged["aiConnection"], existing["aiConnection"]);
        assert_eq!(merged["debug"], existing["debug"]);
        assert_eq!(merged["heartbeat"]["wakeOnDemand"], true);
        assert_eq!(merged["heartbeat"]["intervalSec"], 600);
    }
    #[test]
    fn agent_editor_projection_omits_environment_and_connection_material() {
        let projected = editable_configuration(json!({"id":"agent","name":"Agent","metadata":{"private":true},"adapterConfig":{"model":"model","cwd":"/workspace","env":{"KEY":"value"},"authToken":"value"},"runtimeConfig":{"heartbeat":{"enabled":true},"aiConnection":{"connectionId":"private"},"debug":{"providerTrace":"raw"}}}));
        assert_eq!(projected["adapterConfig"], json!({"model":"model","cwd":"/workspace"}));
        assert_eq!(projected["runtimeConfig"], json!({"heartbeat":{"enabled":true}}));
        assert!(projected.get("metadata").is_none());
    }
    #[tokio::test]
    async fn instruction_paths_and_webhook_creation_are_rejected_before_network() {
        for file in ["auth.json", "../AGENTS.md", "/AGENTS.md", "sub\\AGENTS.md", "AGENTS.md\0"] {
            assert!(paperclip_request("agentInstructionFile".into(), Some("agent-id".into()), Some(json!({"path":file}))).await.is_err());
        }
        let error = paperclip_request("createSchedule".into(), Some("routine-id".into()), Some(json!({"kind":"webhook"}))).await.unwrap_err();
        assert!(error.contains("Only scheduled"));
    }
    #[test]
    fn private_writes_replace_complete_documents() {
        let root = std::env::temp_dir().join(format!("ccgui-paperclip-{}", uuid::Uuid::new_v4()));
        let path = root.join("config.json");
        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600); }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "Requires an explicitly selected running local Paperclip instance"]
    async fn paperclip_live_read_contracts() {
        let port: u16 = std::env::var("CCGUI_PAPERCLIP_TEST_PORT").expect("Set CCGUI_PAPERCLIP_TEST_PORT").parse().unwrap();
        let health = request(port, reqwest::Method::GET, "health", None).await.unwrap();
        assert_eq!(health["deploymentMode"], "local_trusted");
        let companies = request(port, reqwest::Method::GET, "companies", None).await.unwrap();
        let id = companies.as_array().unwrap().first().expect("At least one company")["id"].as_str().unwrap();
        for action in ["agents", "projects", "issues", "runs", "dashboard", "goals", "approvals", "routines", "budgets", "costByAgent", "usageRuns"] {
            let (method, path) = route(action, Some(id)).unwrap();
            let response = request(port, method, &path, None).await.unwrap();
            if action == "dashboard" { assert!(response["costs"]["monthSpendCents"].is_number()); }
            else if action == "budgets" { assert!(response["policies"].is_array()); }
            else { assert!(response.is_array(), "{action}"); }
            if action == "issues" {
                if let Some(issue) = response.as_array().unwrap().first() {
                    for detail in ["issue", "comments", "issueLiveRuns", "issueExecution"] {
                        let (method, path) = route(detail, issue["id"].as_str()).unwrap();
                        let response = request(port, method, &path, None).await.unwrap();
                        if detail == "comments" || detail == "issueLiveRuns" { assert!(response.is_array()); }
                        else if detail == "issue" { assert!(response["title"].is_string()); }
                        else if let Some(run_id) = response["runId"].as_str() {
                            let (_, path) = route("runStatus", Some(run_id)).unwrap();
                            let run = activity::run(request(port, reqwest::Method::GET, &path, None).await.unwrap());
                            assert!(run["status"].is_string());
                            assert!(run.get("contextSnapshot").is_none());
                            let (_, path) = route("runEvents", Some(run_id)).unwrap();
                            let events = activity::events(request(port, reqwest::Method::GET, &format!("{path}?afterSeq=0&limit=200"), None).await.unwrap(), 0);
                            assert!(events["events"].is_array()); assert!(events["nextSeq"].is_number());
                        }
                    }
                }
            }
        }
        let avatar = paperclip_avatar(Some("pink-lemonade".into()), None, port).await.unwrap();
        assert!(avatar.starts_with("data:image/png;base64,"));
    }
}
