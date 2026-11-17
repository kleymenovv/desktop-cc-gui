//! Explicit, per-user launchd service. The worker adopts an already listening
//! instance without taking ownership, and only signals the process group that
//! it creates itself. It never enumerates or terminates other applications.
use super::PaperclipConfig;
use serde_json::{json, Value};

#[cfg(not(target_os = "macos"))]
pub fn status() -> Result<Value, String> { Ok(json!({ "supported": false, "installed": false, "running": false })) }
#[cfg(not(target_os = "macos"))]
pub fn install(_: PaperclipConfig) -> Result<Value, String> { Err("Background service currently requires macOS".into()) }
#[cfg(not(target_os = "macos"))]
pub fn uninstall() -> Result<Value, String> { Err("Background service currently requires macOS".into()) }

/// Run before initializing Tauri, so launchd can run the worker without windows,
/// tray icons, plugin loading, or application startup side effects.
pub fn run_if_requested() -> Option<Result<(), String>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|v| v != "--paperclip-service") { return None; }
    #[cfg(target_os = "macos")]
    { Some(macos::worker(args.get(2).ok_or("Missing worker configuration path").map(std::path::PathBuf::from))) }
    #[cfg(not(target_os = "macos"))]
    { Some(Err("Paperclip service requires macOS".into())) }
}

#[cfg(target_os = "macos")]
pub use macos::{install, status, uninstall};

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{fs, net::{SocketAddr, TcpStream}, path::{Path, PathBuf}, process::{Child, Command, Stdio},
        sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
    use std::os::unix::{fs::{OpenOptionsExt, PermissionsExt}, process::CommandExt};

    const LABEL: &str = "io.ccgui.paperclip";
    static STOP: AtomicBool = AtomicBool::new(false);
    static CONTROL: Mutex<()> = Mutex::new(());
    extern "C" fn terminate(_: libc::c_int) { STOP.store(true, Ordering::Relaxed); }

    fn domain() -> String { format!("gui/{}", unsafe { libc::getuid() }) }
    fn target() -> String { format!("{}/{LABEL}", domain()) }
    fn plist_path() -> PathBuf { crate::paths::home_dir().join("Library/LaunchAgents/io.ccgui.paperclip.plist") }
    fn loaded() -> Result<bool, String> {
        Command::new("/bin/launchctl").args(["print", &target()]).output()
            .map(|out| out.status.success()).map_err(|e| e.to_string())
    }
    fn launchctl(args: &[&str]) -> Result<(), String> {
        let output = Command::new("/bin/launchctl").args(args).output().map_err(|e| e.to_string())?;
        if output.status.success() { Ok(()) } else {
            Err(format!("launchctl: {}", String::from_utf8_lossy(&output.stderr).trim()))
        }
    }
    fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
    pub fn status() -> Result<Value, String> {
        let running = loaded()?;
        let snapshot: Option<Value> = fs::read(super::super::directory().join("status.json")).ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let fresh = snapshot.as_ref().and_then(|s| s["updatedAt"].as_u64())
            .is_some_and(|time| now().saturating_sub(time) < 30);
        Ok(json!({ "supported": true, "installed": plist_path().is_file(), "running": running,
            "worker": if running && fresh { snapshot } else { None },
            "logPath": super::super::directory().join("service.log").to_string_lossy() }))
    }

    fn xml(raw: &str) -> String {
        raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
            .replace('"', "&quot;").replace('\'', "&apos;")
    }
    fn absolute_existing(raw: &str, directory: bool) -> Result<PathBuf, String> {
        let path = PathBuf::from(raw);
        if !path.is_absolute() || if directory { !path.is_dir() } else { !path.is_file() } {
            return Err(format!("Expected an existing absolute {}: {raw}", if directory { "directory" } else { "file" }));
        }
        fs::canonicalize(path).map_err(|e| e.to_string())
    }
    fn validate(config: &PaperclipConfig) -> Result<(), String> {
        if config.port == 0 { return Err("Invalid port".into()); }
        let source = absolute_existing(&config.source_dir, true)?;
        let package: Value = serde_json::from_slice(&fs::read(source.join("package.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if package["name"] != "paperclip" || !package["scripts"]["dev:once"].is_string() || !source.join("server/package.json").is_file() {
            return Err("Select the Paperclip source repository with a dev:once script".into());
        }
        absolute_existing(&config.node_path, false)?;
        absolute_existing(&config.pnpm_path, false)?;
        // Never silently initialize another home in place of an existing instance.
        absolute_existing(&config.data_dir, true)?;
        Ok(())
    }
    pub fn install(config: PaperclipConfig) -> Result<Value, String> {
        let _guard = CONTROL.lock().map_err(|e| e.to_string())?;
        validate(&config)?;
        let root = super::super::directory();
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        // Stable worker location survives app updates and development rebuilds.
        // Copy first; a failed copy never stops a working service.
        let temp_worker = root.join(format!(".worker-{}", uuid::Uuid::new_v4()));
        fs::copy(std::env::current_exe().map_err(|e| e.to_string())?, &temp_worker).map_err(|e| e.to_string())?;
        fs::set_permissions(&temp_worker, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        if loaded()? { launchctl(&["bootout", &target()])?; }
        let worker = root.join("ccgui-paperclip-worker");
        fs::rename(temp_worker, &worker).map_err(|e| e.to_string())?;
        super::super::save_config(&config)?;
        let config_path = root.join("config.json");
        let log = root.join("service.log");
        fs::OpenOptions::new().create(true).append(true).mode(0o600).open(&log).map_err(|e| e.to_string())?;
        let plist = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{LABEL}</string>
<key>ProgramArguments</key><array><string>{}</string><string>--paperclip-service</string><string>{}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>25</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>{}</string><key>StandardErrorPath</key><string>{}</string>
</dict></plist>"#, xml(&worker.to_string_lossy()), xml(&config_path.to_string_lossy()), xml(&log.to_string_lossy()), xml(&log.to_string_lossy()));
        super::super::write_private(&plist_path(), plist.as_bytes())?;
        launchctl(&["bootstrap", &domain(), &plist_path().to_string_lossy()])?;
        status()
    }
    pub fn uninstall() -> Result<Value, String> {
        let _guard = CONTROL.lock().map_err(|e| e.to_string())?;
        if loaded()? { launchctl(&["bootout", &target()])?; }
        if plist_path().exists() { fs::remove_file(plist_path()).map_err(|e| e.to_string())?; }
        // Data, configuration and external Paperclip processes are retained.
        status()
    }

    fn listening(port: u16) -> bool {
        TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(500)).is_ok()
    }
    fn online(client: &reqwest::blocking::Client, port: u16) -> bool {
        client.get(format!("http://127.0.0.1:{port}/api/health")).send().ok()
            .filter(|r| r.status().is_success()).and_then(|r| r.json::<Value>().ok())
            .is_some_and(|v| v["status"] == "ok" && v["deploymentMode"] == "local_trusted")
    }
    fn spawn(config: &PaperclipConfig, log: &Path) -> Result<Child, String> {
        let stdout = fs::OpenOptions::new().create(true).append(true).mode(0o600).open(log).map_err(|e| e.to_string())?;
        let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
        let node_dir = Path::new(&config.node_path).parent().ok_or("Invalid Node path")?;
        let pnpm_dir = Path::new(&config.pnpm_path).parent().ok_or("Invalid pnpm path")?;
        let mut paths = vec![node_dir.to_path_buf(), pnpm_dir.to_path_buf(),
            PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"),
            crate::paths::home_dir().join(".local/bin"), crate::paths::home_dir().join(".cargo/bin")];
        paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
        // Executing repository scripts occurs only after the user starts the
        // service with this source and data directory displayed in the UI.
        Command::new(&config.node_path).arg(&config.pnpm_path).args(["dev:once", "--data-dir", &config.data_dir, "--bind", "loopback"])
            .current_dir(&config.source_dir).env("PATH", std::env::join_paths(paths).map_err(|e| e.to_string())?)
            .env("PORT", config.port.to_string()).env("PAPERCLIP_TELEMETRY_DISABLED", "1")
            .stdin(Stdio::null()).stdout(stdout).stderr(stderr).process_group(0)
            .spawn().map_err(|e| format!("Cannot start Paperclip: {e}"))
    }
    fn stop_owned(child: &mut Child) {
        stop_owned_with_grace(child, Duration::from_secs(20));
    }
    fn stop_owned_with_grace(child: &mut Child, grace: Duration) {
        // Group was created by spawn(), never obtained by process enumeration.
        let group = -(child.id() as i32);
        unsafe { libc::kill(group, libc::SIGTERM); }
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            // The pnpm parent exiting does not prove its descendants exited.
            // Keep the group until every member is gone, including a child
            // that ignored SIGTERM or detached its stdio.
            let _ = child.try_wait();
            if unsafe { libc::kill(group, 0) } == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) { return; }
            std::thread::sleep(Duration::from_millis(100));
        }
        unsafe { libc::kill(group, libc::SIGKILL); }
        let _ = child.wait();
    }
    pub fn worker(config_path: Result<PathBuf, &str>) -> Result<(), String> {
        let config_path = config_path.map_err(str::to_owned)?;
        let root = config_path.parent().ok_or("Missing worker directory")?;
        let config: PaperclipConfig = serde_json::from_slice(&fs::read(&config_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        validate(&config)?;
        unsafe { libc::signal(libc::SIGTERM, terminate as *const () as libc::sighandler_t); libc::signal(libc::SIGINT, terminate as *const () as libc::sighandler_t); }
        let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3)).build().map_err(|e| e.to_string())?;
        let mut child: Option<Child> = None;
        let mut assertion: Option<Awake> = None;
        let mut next_start = 0;
        let mut last_error = None;
        while !STOP.load(Ordering::Relaxed) {
            let mut error = None;
            if let Some(owned) = child.as_mut() {
                match owned.try_wait() {
                    Ok(Some(code)) => {
                        error = Some(format!("Paperclip exited: {code}"));
                        stop_owned(owned);
                        child = None;
                        next_start = now() + 30;
                    }
                    Ok(None) => {},
                    Err(e) => { error = Some(format!("Cannot inspect owned Paperclip child: {e}")); },
                }
            }
            if child.is_none() && now() >= next_start && !listening(config.port) {
                match spawn(&config, &root.join("service.log")) {
                    Ok(started) => child = Some(started),
                    Err(e) => { error = Some(e); next_start = now() + 30; },
                }
            }
            let healthy = online(&client, config.port);
            if healthy { last_error = None; }
            // Keep the machine available during startup/recovery too. The
            // explicit service preference owns this assertion, never a view.
            if config.keep_awake && assertion.is_none() {
                match Awake::new() { Ok(awake) => assertion = Some(awake), Err(e) => error = Some(e) }
            }
            if error.is_some() { last_error = error; }
            let value = json!({ "updatedAt": now(), "online": healthy,
                "ownership": if child.is_some() { "managed" } else { "external" },
                "keepAwake": assertion.is_some(), "error": last_error });
            if let Err(e) = super::super::write_private(&root.join("status.json"), value.to_string().as_bytes()) {
                eprintln!("Cannot write Paperclip worker status: {e}");
            }
            for _ in 0..20 {
                if STOP.load(Ordering::Relaxed) { break; }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
        drop(assertion);
        if let Some(mut owned) = child { stop_owned(&mut owned); }
        Ok(())
    }

    // Public IOKit power assertions; no shell commands, persistent pmset
    // changes, or lid-sleep overrides. macOS still controls thermal sleep.
    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(kind: *const std::ffi::c_void, level: u32, name: *const std::ffi::c_void, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(allocator: *const std::ffi::c_void, value: *const libc::c_char, encoding: u32) -> *const std::ffi::c_void;
        fn CFRelease(value: *const std::ffi::c_void);
    }
    struct Awake(Vec<u32>);
    impl Awake {
        fn new() -> Result<Self, String> {
            let mut result = Self(Vec::new());
            for kind in [c"PreventUserIdleSystemSleep", c"PreventSystemSleep"] {
                unsafe {
                    let kind = CFStringCreateWithCString(std::ptr::null(), kind.as_ptr(), 0x08000100);
                    let name = CFStringCreateWithCString(std::ptr::null(), c"CC GUI agent team".as_ptr(), 0x08000100);
                    if kind.is_null() || name.is_null() {
                        if !kind.is_null() { CFRelease(kind); }
                        if !name.is_null() { CFRelease(name); }
                        return Err("Cannot allocate power assertion name".into());
                    }
                    let mut id = 0;
                    let code = IOPMAssertionCreateWithName(kind, 255, name, &mut id);
                    CFRelease(kind); CFRelease(name);
                    if code != 0 { return Err(format!("Cannot prevent automatic sleep (IOKit {code})")); }
                    result.0.push(id);
                }
            }
            Ok(result)
        }
    }
    impl Drop for Awake { fn drop(&mut self) { for id in &self.0 { unsafe { IOPMAssertionRelease(*id); } } } }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn launchd_xml_escapes_paths() { assert_eq!(xml("a&b<\"'"), "a&amp;b&lt;&quot;&apos;"); }
        #[test]
        fn service_requires_explicit_existing_paths() {
            let config = PaperclipConfig { port: 3100, source_dir: "relative".into(), data_dir: "".into(), node_path: "".into(), pnpm_path: "".into(), keep_awake: false };
            assert!(validate(&config).unwrap_err().contains("absolute"));
        }
        #[test]
        fn stops_owned_descendants_after_the_launcher_exits() {
            use std::io::{BufRead, BufReader, Read};
            // Fixed test fixture: the shell exits while its own sleep child
            // ignores SIGTERM and retains stdout. No system processes are
            // discovered; only this explicitly created group is signalled.
            let mut child = Command::new("/bin/sh")
                .args(["-c", "trap '' TERM; sleep 30 & echo ready; exit 0"])
                .stdout(Stdio::piped()).stderr(Stdio::null()).process_group(0).spawn().unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap());
            let mut ready = String::new();
            output.read_line(&mut ready).unwrap();
            assert_eq!(ready.trim(), "ready");
            stop_owned_with_grace(&mut child, Duration::from_millis(300));
            let mut tail = String::new();
            output.read_to_string(&mut tail).unwrap();
            assert!(child.try_wait().unwrap().is_some());
        }
    }
}
