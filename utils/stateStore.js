'use strict';

const fs = require('fs');
const path = require('path');

function ensureDirectory(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function cloneFallback(fallbackState) {
  if (!fallbackState || typeof fallbackState !== 'object') return fallbackState;
  return JSON.parse(JSON.stringify(fallbackState));
}

function backupCorruptFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const backupPath = `${filePath}.corrupt-${Date.now()}.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function loadJsonState(filePath, fallbackState = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return cloneFallback(fallbackState);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return cloneFallback(fallbackState);
    }

    return JSON.parse(raw);
  } catch (error) {
    let backupPath = null;

    try {
      backupPath = backupCorruptFile(filePath);
    } catch (backupError) {
      console.warn(`StateStore failed to back up corrupt state ${filePath}:`, backupError.message);
    }

    console.warn(
      `StateStore failed to load state ${filePath}; using fallback${backupPath ? ` after backup ${backupPath}` : ''}:`,
      error.message
    );

    return cloneFallback(fallbackState);
  }
}

function saveJsonState(filePath, state = {}) {
  ensureDirectory(filePath);

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const serialized = JSON.stringify(state, null, 2);

  fs.writeFileSync(tempPath, serialized);
  fs.renameSync(tempPath, filePath);

  return {
    ok: true,
    filePath
  };
}

module.exports = {
  loadJsonState,
  saveJsonState
};
