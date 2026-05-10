mod api_types;
mod commands;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_store::StoreExt;

// Restore the user's last saved widget position if it's still on a connected
// monitor. Otherwise anchor on the right edge of the monitor under the cursor
// (or primary as a fallback) at ~75% screen height — well below center, far
// enough from the bottom that the expanded popover still has room to grow up.
fn position_widget(app: &AppHandle, win: &WebviewWindow) {
    if let Ok(store) = app.store("settings.json") {
        if let Some(arr) = store.get("widget_position") {
            let saved = arr
                .get(0)
                .and_then(|v| v.as_i64())
                .and_then(|x| arr.get(1).and_then(|v| v.as_i64()).map(|y| (x as i32, y as i32)));
            if let Some((x, y)) = saved {
                // Validate the position still lies on a visible monitor —
                // guards against an unplugged display sending the widget into
                // the void.
                if matches!(app.monitor_from_point(x as f64, y as f64), Ok(Some(_))) {
                    let _ = win.set_position(PhysicalPosition::new(x, y));
                    return;
                }
            }
        }
    }

    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cp| app.monitor_from_point(cp.x, cp.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else { return };
    let Ok(win_size) = win.outer_size() else { return };
    let mon_size = monitor.size();
    let mon_pos = monitor.position();
    const RIGHT_MARGIN: i32 = 24;
    let x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - RIGHT_MARGIN;
    let y = mon_pos.y + (mon_size.height as i32 * 75 / 100) - (win_size.height as i32 / 2);
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn save_widget_position(app: &AppHandle, x: i32, y: i32) {
    if let Ok(store) = app.store("settings.json") {
        store.set("widget_position", serde_json::json!([x, y]));
        let _ = store.save();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::fetch_usage,
            commands::save_settings,
            commands::load_settings,
            // commands::auto_detect_org,  // legacy sessionKey path — see commands.rs
            commands::fetch_local_usage,
            commands::open_full_dashboard,
        ])
        .setup(|app| {
            app.manage(reqwest::Client::new());

            if let Some(win) = app.get_webview_window("main") {
                position_widget(&app.handle().clone(), &win);

                // Persist the user's drag position so they don't have to re-place
                // the widget on every startup. Saves on every Moved event — the
                // store keeps an in-memory copy and writes a small JSON file, so
                // the I/O cost during a drag is negligible.
                let app_for_save = app.handle().clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::Moved(pos) = event {
                        save_widget_position(&app_for_save, pos.x, pos.y);
                    }
                });
            }

            let show = MenuItem::with_id(app, "show", "Show TokenBBQ", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &refresh, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("TokenBBQ")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                            let _ = win.emit("resume-polling", ());
                        }
                    }
                    "refresh" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.emit("refresh-usage", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TokenBBQ");
}
