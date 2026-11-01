import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initPersistence } from './lib/store';

// In the Tauri build, sync with the SQLite database before first paint
// (no-op in the browser). Never blocks forever: failures fall back gracefully.
void initPersistence().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>
  );
});
