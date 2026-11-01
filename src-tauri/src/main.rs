// MedStore Manager — Tauri (Rust) shell.
//
// Responsibilities of this layer:
//  1. Own the real SQLite database file in the Windows app-data directory:
//       %APPDATA%\com.medstore.manager\medstore.db
//     (never inside Program Files, so updates never delete business data).
//  2. Apply SQL migrations (database/migrations/*.sql) on launch.
//  3. Expose a small, safe command surface to the frontend:
//       - db_load_state / db_save_state : the TypeScript engine (src/core/engine.ts)
//         runs ALL business rules (RBAC, FEFO, paisa accounting, transactions)
//         and hands this layer a serialized state snapshot to persist inside the
//         SQLite `app_state` table within a single SQLite transaction. The
//         normalized relational tables from migration 001 are maintained as the
//         canonical schema reference and are used by the integrity/export tooling;
//         keeping one rules engine guarantees identical behaviour in dev and
//         production.
//       - db_backup_to / db_restore_from : SQLite online-backup API copies
//         (safe while the app is running), with PRAGMA integrity_check.
//  4. Print via the WebView print pipeline (thermal + standard printers).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::Connection;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

struct DbPath(PathBuf);
struct LogPath(Mutex<Option<PathBuf>>);

fn open(db_path: &PathBuf) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_state (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           state_json TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    // Apply bundled relational migrations exactly once each, in version order.
    // 001 = initial schema, 002 = multi-barcode packaging, 003 = expense reversal (all non-destructive).
    const MIGRATIONS: &[(i64, &str)] = &[
        (1, include_str!("../../database/migrations/001_initial.sql")),
        (2, include_str!("../../database/migrations/002_barcodes.sql")),
        (3, include_str!("../../database/migrations/003_quality_fixes.sql")),
    ];
    for (version, sql) in MIGRATIONS {
        let applied: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !applied {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
                [version],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn db_load_state(path: State<'_, DbPath>) -> Result<Option<String>, String> {
    let conn = open(&path.0)?;
    migrate(&conn)?;
    let mut stmt = conn
        .prepare("SELECT state_json FROM app_state WHERE id = 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => row.get(0).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
fn db_save_state(path: State<'_, DbPath>, state_json: String) -> Result<(), String> {
    let mut conn = open(&path.0)?;
    migrate(&conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?1, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
        [&state_json],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_backup_to(path: State<'_, DbPath>, dest: String) -> Result<String, String> {
    let conn = open(&path.0)?;
    let mut dest_conn = Connection::open(&dest).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&conn, &mut dest_conn).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    let check: String = dest_conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("Backup integrity check failed: {check}"));
    }
    Ok(format!("Backup verified OK: {dest}"))
}

#[tauri::command]
fn db_restore_from(path: State<'_, DbPath>, src: String) -> Result<String, String> {
    // 1) Validate source integrity before touching the live database.
    {
        let src_conn = Connection::open(&src).map_err(|e| e.to_string())?;
        let check: String = src_conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err(format!("Backup file failed integrity check: {check}"));
        }
    }
    // 2) Safety-copy the current database, then replace it.
    let safety = path.0.with_extension(format!("safety-{}.db", chrono_now()));
    if path.0.exists() {
        fs::copy(&path.0, &safety).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &path.0).map_err(|e| e.to_string())?;
    // 3) Verify the restored database.
    let conn = open(&path.0)?;
    let check: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        // Roll back to the safety copy — never leave the store with a bad DB.
        let _ = fs::copy(&safety, &path.0);
        return Err("Restored database failed verification; previous database restored.".into());
    }
    Ok(format!(
        "Restore verified OK. Safety copy kept at {}",
        safety.display()
    ))
}

fn chrono_now() -> String {
    // Avoid extra deps: unix timestamp is enough for a unique suffix.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[tauri::command]
fn db_backup_auto(app: AppHandle, path: State<'_, DbPath>) -> Result<String, String> {
    // Writes <app-data>/backups/medstore-backup-<unix>.db and returns the path.
    // Uses the SQLite online-backup API, safe while the app is running.
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("medstore-backup-{}.db", chrono_now()));
    let msg = db_backup_to_inner(&path.0, &dest.to_string_lossy())?;
    Ok(format!("{}|{}", dest.display(), msg))
}

fn db_backup_to_inner(db_path: &PathBuf, dest: &str) -> Result<String, String> {
    let conn = open(db_path)?;
    let mut dest_conn = Connection::open(dest).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&conn, &mut dest_conn).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    let check: String = dest_conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("Backup integrity check failed: {check}"));
    }
    Ok(format!("Backup verified OK: {dest}"))
}

#[tauri::command]
fn db_info(app: AppHandle, path: State<'_, DbPath>) -> Result<serde_json::Value, String> {
    let _ = app;
    Ok(serde_json::json!({
        "databasePath": path.0.display().to_string(),
        "sqliteVersion": rusqlite::version(),
    }))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app data dir");
            fs::create_dir_all(&dir).ok();
            app.manage(DbPath(dir.join("medstore.db")));
            app.manage(LogPath(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_load_state,
            db_save_state,
            db_backup_to,
            db_backup_auto,
            db_restore_from,
            db_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running MedStore Manager");
}
