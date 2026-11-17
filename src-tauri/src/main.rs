// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(result) = ccgui_next_lib::paperclip::service::run_if_requested() {
        if let Err(error) = result {
            eprintln!("Paperclip worker: {error}");
            std::process::exit(1);
        }
        return;
    }
    ccgui_next_lib::run()
}
