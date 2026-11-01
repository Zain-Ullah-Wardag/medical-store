import { useEffect, useState } from 'react';
import { Engine, emptyDb, migrateDb } from '../core/engine';
import type { DbState, SessionUser } from '../core/types';

/**
 * Persistence layer.
 *
 * Browser / dev: state is kept in localStorage (full workflow testable).
 *
 * Tauri (Windows): the Rust layer owns a real SQLite file in the app-data
 * directory (%APPDATA%\com.medstore.manager\medstore.db) and the engine state
 * snapshot is saved into it (see src-tauri/src/main.rs). On first launch of a
 * build with this wiring, any data previously saved in the WebView's
 * localStorage is migrated INTO SQLite once — existing business records are
 * preserved, never reset. localStorage remains as a redundant mirror.
 */
const KEY = 'medstore-db-v1';
const SES_KEY = 'medstore-session';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function loadLocal(): { db: DbState; hadData: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { db: migrateDb({ ...emptyDb(), ...JSON.parse(raw) }), hadData: true };
  } catch { /* corrupted storage -> start fresh, user can restore a backup */ }
  return { db: emptyDb(), hadData: false };
}

const initial = loadLocal();

let saveTimer: number | undefined;
let pendingJson = '';
export async function flushPersistence(): Promise<void> {
  if (!isTauri || !pendingJson) return;
  const json = pendingJson; pendingJson = '';
  try { await tauriInvoke('db_save_state', { stateJson: json }); }
  catch (e) { console.warn('SQLite save failed (localStorage mirror still updated):', e); }
}

export const engine = new Engine(initial.db, (db) => {
  const json = JSON.stringify(db);
  try { localStorage.setItem(KEY, json); } catch { /* storage full — export a backup */ }
  if (isTauri) {
    pendingJson = json;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushPersistence(), 250);
  }
  listeners.forEach(l => l());
});

/**
 * Tauri startup sync — call once before first render.
 * - SQLite has state and localStorage is empty  -> load SQLite state.
 * - SQLite empty and localStorage has data      -> one-time migration into SQLite.
 * - Both have data                              -> they are mirrors; keep current.
 * Never deletes anything.
 */
export async function initPersistence(): Promise<void> {
  if (!isTauri) return;
  try {
    const sqliteJson = await tauriInvoke<string | null>('db_load_state');
    if (sqliteJson && !initial.hadData) {
      engine.replaceStateFromJson(sqliteJson);
      sessionStorage.removeItem(SES_KEY); // session may belong to the other state
    } else if (!sqliteJson && initial.hadData) {
      pendingJson = JSON.stringify(engine.db);
      await flushPersistence(); // one-time localStorage -> SQLite migration
    }
  } catch (e) {
    console.warn('Tauri persistence init failed; continuing with localStorage:', e);
  }
}

/** Creates a timestamped SQLite .db backup inside the app-data backups folder (Tauri only). */
export async function backupSqliteFile(): Promise<string> {
  await flushPersistence();
  return tauriInvoke<string>('db_backup_auto');
}
export async function databaseInfo(): Promise<{ databasePath: string; sqliteVersion: string } | null> {
  if (!isTauri) return null;
  try { return await tauriInvoke('db_info'); } catch { return null; }
}

const listeners = new Set<() => void>();
export function useDbVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => { const fn = () => setV(x => x + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  return v;
}

export function loadSession(): SessionUser | null {
  try { const raw = sessionStorage.getItem(SES_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveSession(u: SessionUser | null) {
  if (u) sessionStorage.setItem(SES_KEY, JSON.stringify(u)); else sessionStorage.removeItem(SES_KEY);
}

export const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36);
