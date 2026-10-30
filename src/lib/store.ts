import { useEffect, useState } from 'react';
import { Engine, emptyDb, migrateDb } from '../core/engine';
import type { DbState, SessionUser } from '../core/types';

/**
 * Persistence layer.
 * - In the Tauri (Windows) build, the Rust layer owns a real SQLite file in the
 *   app-data directory (%APPDATA%\MedStore Manager\medstore.db); see src-tauri/.
 * - In browser/dev mode the identical state is persisted to localStorage so the
 *   full workflow (setup → purchase → sale → reports → backup) is testable.
 */
const KEY = 'medstore-db-v1';
const SES_KEY = 'medstore-session';

function load(): DbState {
  try {
    const raw = localStorage.getItem(KEY);
    // migrateDb upgrades older saved states in place (e.g. v1 → v2 barcodes)
    // without touching any existing business records.
    if (raw) return migrateDb({ ...emptyDb(), ...JSON.parse(raw) });
  } catch { /* corrupted storage -> start fresh, user can restore a backup */ }
  return emptyDb();
}

export const engine = new Engine(load(), (db) => {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full — export a backup */ }
  listeners.forEach(l => l());
});

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
