//! App-owned, click-through action cursor and target outline. No input capture
//! or injection occurs here: the separate driver sends authenticated previews.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::Manager;

use crate::cu_protocol::ActionPreview;

const CURSOR: &str = "cu-cursor";
const HIGHLIGHT: &str = "cu-highlight";
const HOTSPOT: (f64, f64) = (15.0, 12.0);
const PREVIEW_MS: u64 = 180;
const IDLE_HIDE_SECS: u64 = 30;

pub struct OverlayManager {
    token: String,
    port: u16,
    inner: Mutex<HashMap<String, OverlayInner>>,
}
struct OverlayInner {
    visible: bool,
    preparing: bool,
    pos: (f64, f64),
    generation: u64,
    last_event: Instant,
}
static MANAGER: OnceLock<OverlayManager> = OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static EPOCH: AtomicU64 = AtomicU64::new(0);
static READY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn readiness(label: &str) -> Arc<AtomicBool> {
    READY
        .get_or_init(Default::default)
        .lock()
        .entry(label.into())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}
fn labels(agent: Option<&str>) -> (String, String) {
    match agent {
        Some(id) => (format!("{CURSOR}-{id}"), format!("{HIGHLIGHT}-{id}")),
        None => (CURSOR.into(), HIGHLIGHT.into()),
    }
}

pub fn control_base() -> Option<String> {
    MANAGER
        .get()
        .map(|m| format!("http://127.0.0.1:{}", m.port))
}
pub fn control_token() -> Option<String> {
    MANAGER.get().map(|m| m.token.clone())
}

#[derive(Deserialize)]
struct SessionPayload {
    active: bool,
}
#[derive(Deserialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    start_server()
}
fn start_server() -> Result<(), String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("bind cursor control channel: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    MANAGER
        .set(OverlayManager {
            token: token.clone(),
            port,
            inner: Mutex::new(HashMap::new()),
        })
        .map_err(|_| "Cursor server is already initialized".to_string())?;
    let router = axum::Router::new()
        .route("/session", axum::routing::post(session_handler))
        .route("/cursor", axum::routing::post(cursor_handler))
        .route("/action", axum::routing::post(action_handler))
        .route("/team", axum::routing::post(team_handler))
        .layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let token = token.clone();
                async move {
                    let ok = req
                        .headers()
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.strip_prefix("Bearer "))
                        .is_some_and(|v| v == token);
                    if ok {
                        next.run(req).await
                    } else {
                        axum::http::StatusCode::UNAUTHORIZED.into_response()
                    }
                }
            },
        ));
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                let _ = axum::serve(listener, router).await;
            }
            Err(error) => eprintln!("[cu-overlay] control channel failed: {error}"),
        }
    });
    tauri::async_runtime::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let Some(manager) = MANAGER.get() else { return };
            let stale = {
                let inner = manager.inner.lock();
                inner.values().any(|s| s.visible)
                    && !inner.values().any(|s| s.visible && s.preparing)
                    && inner
                        .values()
                        .all(|s| s.last_event.elapsed() > Duration::from_secs(IDLE_HIDE_SECS))
            };
            if stale {
                hide();
            }
        }
    });
    Ok(())
}
async fn session_handler(
    axum::Json(payload): axum::Json<SessionPayload>,
) -> axum::http::StatusCode {
    if !payload.active {
        hide();
    }
    axum::http::StatusCode::OK
}
async fn team_handler() -> Response {
    match prepare_team(3).await {
        Ok(()) => axum::http::StatusCode::OK.into_response(),
        Err(error) => (axum::http::StatusCode::SERVICE_UNAVAILABLE, error).into_response(),
    }
}
async fn cursor_handler(axum::Json(payload): axum::Json<CursorPayload>) -> Response {
    action_handler(axum::Json(ActionPreview::new("move", payload.x, payload.y))).await
}
async fn action_handler(axum::Json(action): axum::Json<ActionPreview>) -> Response {
    if let Err(message) = action.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, message).into_response();
    }
    match present(action).await {
        Ok(()) => axum::http::StatusCode::OK.into_response(),
        Err(error) => {
            hide();
            eprintln!("[cu-overlay] cannot present action: {error}");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "Action preview unavailable; no input should be sent",
            )
                .into_response()
        }
    }
}

/// Unlike the old blocking recv, this never blocks Tauri's event loop while
/// constructing WebKit windows. All AppKit/window operations stay on main.
async fn on_main<F>(operation: F) -> Result<(), String>
where
    F: FnOnce(&tauri::AppHandle) -> Result<(), String> + Send + 'static,
{
    let Some(app) = APP.get() else { return Ok(()) }; // Pure protocol tests.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(operation(&handle));
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| "Cursor main-thread operation timed out".to_string())?
        .map_err(|_| "Cursor main-thread operation cancelled".to_string())?
}

fn ensure_window(
    app: &tauri::AppHandle,
    label: &str,
    page: &str,
    width: f64,
    height: f64,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let ready = readiness(label);
    ready.store(false, Ordering::Release);
    let window = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(page.into()))
        .title("CC GUI")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .focused(false)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .inner_size(width, height)
        .visible(false)
        .on_page_load(move |_, payload| {
            ready.store(
                matches!(payload.event(), tauri::webview::PageLoadEvent::Finished),
                Ordering::Release,
            );
        })
        .build()
        .map_err(|e| format!("create {label}: {e}"))?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as Behavior};
        let raw = window.ns_window().map_err(|e| e.to_string())?;
        let native = unsafe { &*(raw as *mut NSWindow) };
        let behavior = (native.collectionBehavior()
            | Behavior::CanJoinAllSpaces
            | Behavior::FullScreenAuxiliary
            | Behavior::IgnoresCycle)
            & !Behavior::FullScreenPrimary
            & !Behavior::MoveToActiveSpace;
        native.setCollectionBehavior(behavior);
        native.setLevel(25); // Status-window level; above normal application windows.
    }
    Ok(window)
}

pub async fn present(action: ActionPreview) -> Result<(), String> {
    action.validate().map_err(str::to_owned)?;
    let manager = MANAGER.get().ok_or("Cursor control is not initialized")?;
    let epoch = EPOCH.load(Ordering::Acquire);
    let target = (action.x, action.y);
    let (cursor_label, highlight_label) = labels(action.agent_id.as_deref());
    let key = cursor_label.clone();
    let (from, generation) = {
        let mut states = manager.inner.lock();
        let inner = states.entry(key.clone()).or_insert_with(|| OverlayInner {
            visible: false,
            preparing: false,
            pos: target,
            generation: 0,
            last_event: Instant::now(),
        });
        let from = if inner.visible { inner.pos } else { target };
        inner.generation += 1;
        inner.visible = true;
        inner.preparing = action.kind == "preparing";
        inner.last_event = Instant::now();
        (from, inner.generation)
    };
    let preview = action.clone();
    let encoded = serde_json::to_string(&action).map_err(|e| e.to_string())?;
    let cursor_name = cursor_label.clone();
    let highlight_name = highlight_label.clone();
    on_main(move |app| {
        if EPOCH.load(Ordering::Acquire) != epoch { return Err("Cursor preview cancelled".into()); }
        let highlight = ensure_window(app, &highlight_name, "cursor-highlight.html", 40.0, 40.0)?;
        let accent = match preview.agent_id.as_deref() { Some("agent-2") => "#34d399", Some("agent-3") => "#fb923c", _ => "#70b6ff" };
        highlight.eval(format!("document.documentElement.style.setProperty('--agent-accent','{accent}');")).map_err(|e| e.to_string())?;
        if let Some(bounds) = preview.bounds {
            highlight.set_size(tauri::LogicalSize::new(bounds.width + 8.0, bounds.height + 8.0)).map_err(|e| e.to_string())?;
            highlight.set_position(tauri::LogicalPosition::new(bounds.x - 4.0, bounds.y - 4.0)).map_err(|e| e.to_string())?;
            highlight.show().map_err(|e| e.to_string())?;
        } else { highlight.hide().map_err(|e| e.to_string())?; }
        let cursor = ensure_window(app, &cursor_name, "cursor.html", 280.0, 88.0)?;
        // Retain the first state until the external page script has loaded;
        // DOM updates use textContent, never HTML from an application label.
        cursor.eval(format!("window.__CCGUI_CURSOR_STATE__={encoded};window.ccguiCursor?.update(window.__CCGUI_CURSOR_STATE__);")).map_err(|e| e.to_string())?;
        cursor.set_position(tauri::LogicalPosition::new(from.0 - HOTSPOT.0, from.1 - HOTSPOT.1)).map_err(|e| e.to_string())?;
        cursor.show().map_err(|e| e.to_string())?;
        if !cursor.is_visible().map_err(|e| e.to_string())? { return Err("Cursor window did not become visible".into()); }
        Ok(())
    }).await?;
    if APP.get().is_some() {
        tokio::time::timeout(Duration::from_millis(1500), async {
            while !readiness(&cursor_label).load(Ordering::Acquire)
                || (action.bounds.is_some() && !readiness(&highlight_label).load(Ordering::Acquire))
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "Cursor page did not finish loading".to_string())?;
        // A navigation may have replaced the initial eval state. Send it again
        // after load, before acknowledging the preview to the driver.
        let encoded = serde_json::to_string(&action).map_err(|e| e.to_string())?;
        let cursor_name = cursor_label.clone();
        on_main(move |app| {
            app.get_webview_window(&cursor_name).ok_or("Cursor window disappeared")?
                .eval(format!("window.__CCGUI_CURSOR_STATE__={encoded};window.ccguiCursor?.update(window.__CCGUI_CURSOR_STATE__);"))
                .map_err(|e| e.to_string())
        }).await?;
    }
    // A brief, bounded pre-action glide makes the target observable BEFORE
    // input, not a cursor that arrives after the button has already fired.
    if EPOCH.load(Ordering::Acquire) != epoch {
        return Err("Cursor preview cancelled".into());
    }
    if action.kind == "preparing" {
        return Ok(());
    }
    for step in 1..=9 {
        if manager
            .inner
            .lock()
            .get(&key)
            .is_none_or(|s| s.generation != generation)
        {
            return Err("Cursor preview cancelled before input".into());
        }
        let t = step as f64 / 9.0;
        let eased = 1.0 - (1.0 - t).powi(3);
        let point = (
            from.0 + (target.0 - from.0) * eased,
            from.1 + (target.1 - from.1) * eased,
        );
        let cursor_name = cursor_label.clone();
        on_main(move |app| {
            let window = app
                .get_webview_window(&cursor_name)
                .ok_or("Cursor window disappeared")?;
            window
                .set_position(tauri::LogicalPosition::new(
                    point.0 - HOTSPOT.0,
                    point.1 - HOTSPOT.1,
                ))
                .map_err(|e| e.to_string())
        })
        .await?;
        {
            if let Some(inner) = manager.inner.lock().get_mut(&key) {
                if inner.generation == generation {
                    inner.pos = point;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(PREVIEW_MS / 9)).await;
    }
    if manager
        .inner
        .lock()
        .get(&key)
        .is_none_or(|s| s.generation != generation)
    {
        return Err("Cursor preview cancelled before input".into());
    }
    Ok(())
}

pub fn hide() {
    EPOCH.fetch_add(1, Ordering::AcqRel);
    if let Some(manager) = MANAGER.get() {
        for inner in manager.inner.lock().values_mut() {
            inner.visible = false;
            inner.generation += 1;
        }
    }
    if let Some(app) = APP.get() {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            for (label, window) in handle.webview_windows() {
                if label.starts_with(CURSOR) || label.starts_with(HIGHLIGHT) {
                    let _ = window.hide();
                }
            }
        });
    }
}
pub fn shutdown() {
    hide();
    if let Some(app) = APP.get() {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            for (label, window) in handle.webview_windows() {
                if label.starts_with(CURSOR) || label.starts_with(HIGHLIGHT) {
                    let _ = window.destroy();
                }
            }
        });
    }
}

/// Called only for an explicitly authorized computer task. No desktop observation.
pub async fn prepare_team(count: usize) -> Result<(), String> {
    if !(1..=3).contains(&count) {
        return Err("Unsupported desktop team size".into());
    }
    let app = APP.get().ok_or("Cursor app unavailable")?;
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let x = (position.x as f64 + size.width as f64 / 2.0) / scale;
    let y = (position.y as f64 + size.height as f64 / 2.0) / scale;
    if count > 1 {
        hide();
    }
    for i in 0..count {
        let mut action = ActionPreview::new(
            "preparing",
            x + (i as f64 - (count - 1) as f64 / 2.0) * 150.0,
            y,
        );
        if count > 1 {
            action.agent_id = Some(format!("agent-{}", i + 1));
        }
        action.label = "CC GUI".into();
        if let Err(error) = present(action).await {
            hide();
            return Err(error);
        }
    }
    Ok(())
}

pub fn start_preparing() {
    let epoch = EPOCH.load(Ordering::Acquire);
    tauri::async_runtime::spawn(async move {
        if EPOCH.load(Ordering::Acquire) != epoch {
            return;
        }
        if let Err(error) = prepare_team(1).await {
            eprintln!("[cu-overlay] prepare: {error}");
        }
    });
}

/// Explicit visual check from Settings; no app is read and no input is sent.
#[tauri::command]
pub async fn computer_use_preview_cursor(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let mut action = ActionPreview::new(
        "move",
        (position.x as f64 + size.width as f64 / 2.0) / scale,
        (position.y as f64 + size.height as f64 / 2.0) / scale,
    );
    action.label = "CC GUI".into();
    present(action).await?;
    let generation = MANAGER
        .get()
        .ok_or("Cursor unavailable")?
        .inner
        .lock()
        .get(CURSOR)
        .map(|s| s.generation);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if MANAGER
            .get()
            .is_some_and(|m| m.inner.lock().get(CURSOR).map(|s| s.generation) == generation)
        {
            hide();
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn control_channel_requires_authentication_and_validates_action_geometry() {
        start_server().expect("start cursor control");
        let base = control_base().unwrap();
        let token = control_token().unwrap();
        let client = reqwest::blocking::Client::new();
        let post = |path: &str, token: Option<&str>, body: serde_json::Value| {
            let request = client.post(format!("{base}{path}")).json(&body);
            let request = match token {
                Some(token) => request.bearer_auth(token),
                None => request,
            };
            request.send().unwrap().status()
        };
        assert_eq!(post("/team", None, serde_json::json!({})), 401);
        assert_eq!(
            post(
                "/action",
                Some(&token),
                serde_json::json!({"kind":"preparing","agentId":"agent-4","x":10,"y":20})
            ),
            400
        );
        std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                post(
                    "/action",
                    Some(&token),
                    serde_json::json!({"kind":"click","agentId":"agent-1","x":10,"y":20}),
                )
            });
            let b = scope.spawn(|| {
                post(
                    "/action",
                    Some(&token),
                    serde_json::json!({"kind":"click","agentId":"agent-2","x":30,"y":40}),
                )
            });
            assert_eq!(a.join().unwrap(), 200);
            assert_eq!(b.join().unwrap(), 200);
        });
        let point = serde_json::json!({"x":10,"y":20});
        assert_eq!(post("/cursor", None, point.clone()), 401);
        assert_eq!(post("/cursor", Some("wrong"), point.clone()), 401);
        assert_eq!(post("/cursor", Some(&token), point), 200);
        assert_eq!(
            post(
                "/action",
                Some(&token),
                serde_json::json!({"kind":"click","x":10,"y":20,"bounds":{"x":0,"y":0,"width":-2,"height":10}})
            ),
            400
        );
        assert_eq!(
            post(
                "/action",
                None,
                serde_json::json!({"kind":"key","x":10,"y":20,"keys":"cmd+s"})
            ),
            401
        );
        assert_eq!(
            post(
                "/action",
                Some(&token),
                serde_json::json!({"kind":"key","x":10,"y":20,"keys":"cmd+s"})
            ),
            200
        );
        assert_eq!(
            post(
                "/session",
                Some(&token),
                serde_json::json!({"active":false})
            ),
            200
        );
    }
}
