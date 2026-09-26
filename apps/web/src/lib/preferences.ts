import * as React from 'react'

/*
 * Client-only: how this browser shows the app. Kept in localStorage, applied
 * to <html> before the first paint by BOOT_SCRIPT so nothing flashes.
 * The theme keeps its own `localStorage.theme` key, which the header toggle
 * also writes.
 */

export type ThemeChoice = 'dark' | 'light' | 'system'
export type TextSize = 'normal' | 'large' | 'larger'
export type MotionChoice = 'system' | 'reduce' | 'full'
export type AlertKind =
  | 'death'
  | 'threat'
  | 'sighting'
  | 'mood'
  | 'birth'
  | 'arrival'
  | 'society'
  | 'artifact'

export interface Preferences {
  textSize: TextSize
  motion: MotionChoice
  /** The citizens walking along the bottom of the window. */
  edgeDwarves: boolean
  /** Let guides run whitelisted DFHack commands; off shows them to copy instead. */
  oneClickActions: boolean
  alertKinds: Record<AlertKind, boolean>
}

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: 'normal',
  motion: 'system',
  edgeDwarves: true,
  oneClickActions: true,
  alertKinds: {
    death: true,
    threat: true,
    sighting: true,
    mood: true,
    birth: true,
    arrival: true,
    society: true,
    artifact: true,
  },
}

const PREFS_KEY = 'fort-preferences'
const listeners = new Set<() => void>()
let cache: Preferences | null = null

function read(): Preferences {
  if (cache) return cache
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Preferences>
    cache = {
      ...DEFAULT_PREFERENCES,
      ...stored,
      alertKinds: { ...DEFAULT_PREFERENCES.alertKinds, ...(stored.alertKinds ?? {}) },
    }
  } catch {
    cache = DEFAULT_PREFERENCES
  }
  return cache
}

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PREFS_KEY && e.key !== 'theme') return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePreferences(): Preferences {
  return React.useSyncExternalStore(subscribe, read, () => DEFAULT_PREFERENCES)
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  const next = { ...read(), [key]: value }
  cache = next
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // Private windows: the choice lasts until the page closes.
  }
  applyToDocument()
  notify()
}

export function resetPreferences() {
  cache = DEFAULT_PREFERENCES
  try {
    localStorage.removeItem(PREFS_KEY)
    localStorage.removeItem('theme')
  } catch {
    // Nothing stored to remove.
  }
  applyToDocument()
  notify()
}

// ---------------------------------------------------------------------------
// Theme

function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem('theme')
    return value === 'light' || value === 'system' ? value : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveDark(theme: ThemeChoice): boolean {
  if (theme === 'light') return false
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return true
}

/** Also notices the header's theme toggle, which only flips the class. */
function subscribeTheme(listener: () => void) {
  const unsubscribe = subscribe(listener)
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => {
    unsubscribe()
    observer.disconnect()
  }
}

export function useTheme(): ThemeChoice {
  return React.useSyncExternalStore(subscribeTheme, readTheme, () => 'dark')
}

export function setTheme(theme: ThemeChoice) {
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // Private windows: the choice lasts until the page closes.
  }
  applyToDocument()
  notify()
}

// ---------------------------------------------------------------------------
// Applying

export function applyToDocument() {
  const root = document.documentElement
  const prefs = read()
  root.classList.toggle('dark', resolveDark(readTheme()))
  root.dataset.text = prefs.textSize
  root.dataset.motion = prefs.motion
}

/** Keeps "follow the system" in step when the OS switches between light and dark. */
export function usePreferencesSync() {
  React.useEffect(() => {
    applyToDocument()
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readTheme() === 'system') applyToDocument()
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
}

/** Runs before the first paint: dark unless chosen otherwise, like the game. */
export const BOOT_SCRIPT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem('theme');var d=t==='light'?false:t==='system'?matchMedia('(prefers-color-scheme: dark)').matches:true;r.classList.toggle('dark',d);var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');r.dataset.text=p.textSize||'normal';r.dataset.motion=p.motion||'system'}catch(e){r.classList.add('dark')}})()`
