import * as React from 'react'

/**
 * How the app tells the player about new happenings: toasts while the app is
 * open, desktop notifications as well while its tab is in the background, or
 * nothing. Kept per browser.
 */
export type AlertMode = 'app' | 'desktop' | 'off'

const STORAGE_KEY = 'fort-alerts'
const listeners = new Set<() => void>()

function read(): AlertMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'desktop' || value === 'off' ? value : 'app'
  } catch {
    return 'app'
  }
}

export function setAlertMode(mode: AlertMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Falls back to the default next time.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAlertMode(): AlertMode {
  return React.useSyncExternalStore(subscribe, read, () => 'app')
}

export function desktopAlertsAllowed(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Ask the browser for permission; falls back to in-app alerts when refused. */
export async function enableDesktopAlerts(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
  setAlertMode(permission === 'granted' ? 'desktop' : 'app')
  return permission === 'granted'
}
