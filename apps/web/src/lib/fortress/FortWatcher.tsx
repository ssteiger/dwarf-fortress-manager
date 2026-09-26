import { useNavigate } from '@tanstack/react-router'
import * as React from 'react'
import { toast } from 'sonner'

import type { FortEvent } from '@fortress/db-drizzle'

import { type AlertKind, usePreferences } from '~/lib/preferences'

import { desktopAlertsAllowed, useAlertMode } from './alerts'
import { formatGameTick, isLiving, unitGroup } from './format'
import { alertLevel, cleanAnnouncement, creatureCounts, storyKind } from './insights'
import { useFortOverview, useFortUnits } from './queries'

/** At most this many toasts per poll, so a siege does not bury the screen. */
const MAX_PER_POLL = 4

/** Which Settings → Alerts switch an announcement answers to. */
function alertKindOf(event: Pick<FortEvent, 'type' | 'text'>): AlertKind | null {
  switch (storyKind(event)) {
    case 'death':
      return 'death'
    case 'threat':
      return 'threat'
    case 'mood':
      return 'mood'
    case 'birth':
      return 'birth'
    case 'arrival':
      return 'arrival'
    case 'society':
      return 'society'
    case 'craft':
      return 'artifact'
    default:
      return null
  }
}

/**
 * Watches the fortress from any page and speaks up about what matters: new
 * deaths, dangers, moods, births and arrivals, and danger coming into sight.
 * Renders nothing. What was already there when the app opened stays quiet.
 */
export function FortWatcher() {
  const navigate = useNavigate()
  const mode = useAlertMode()
  const { alertKinds } = usePreferences()
  const overview = useFortOverview()
  const units = useFortUnits()
  const seenEvent = React.useRef<number | null>(null)
  const seenDanger = React.useRef<Set<number> | null>(null)
  const fortName = overview.data?.state?.fort_name ?? 'The fortress'

  const tell = React.useCallback(
    (title: string, detail: string | undefined, urgent: boolean, tag: string) => {
      const open = {
        label: 'Open',
        onClick: () => navigate({ to: '/fortress' }),
      }
      if (urgent)
        toast.error(title, {
          description: detail,
          action: open,
          duration: 12_000,
        })
      else toast(title, { description: detail, action: open, duration: 8_000 })
      if (mode === 'desktop' && document.hidden && desktopAlertsAllowed()) {
        const note = new Notification(fortName, {
          body: detail ? `${title}\n${detail}` : title,
          tag,
        })
        note.onclick = () => {
          window.focus()
          navigate({ to: '/fortress' })
        }
      }
    },
    [mode, navigate, fortName],
  )

  const events = overview.data?.events
  React.useEffect(() => {
    if (!events) return
    const newest = events.reduce((max, e) => Math.max(max, e.id), 0)
    if (seenEvent.current === null || mode === 'off') {
      seenEvent.current = Math.max(seenEvent.current ?? 0, newest)
      return
    }
    const since = seenEvent.current
    seenEvent.current = Math.max(since, newest)
    const fresh = events
      .filter((e) => {
        if (e.id <= since || alertLevel(e) === null) return false
        const kind = alertKindOf(e)
        return kind !== null && alertKinds[kind]
      })
      .sort((a, b) => a.id - b.id)
    for (const event of fresh.slice(-MAX_PER_POLL)) {
      tell(
        cleanAnnouncement(event.text),
        formatGameTick(event.game_year, event.game_tick) || undefined,
        alertLevel(event) === 'urgent',
        `fort-event-${event.id}`,
      )
    }
    if (fresh.length > MAX_PER_POLL)
      toast(`${fresh.length - MAX_PER_POLL} more things happened`, {
        action: { label: 'Open', onClick: () => navigate({ to: '/fortress' }) },
      })
  }, [events, mode, alertKinds, tell, navigate])

  const all = units.data?.units
  React.useEffect(() => {
    if (!all) return
    const inSight = all.filter(
      (u) => isLiving(u) && unitGroup(u) === 'hostile' && !u.flags.includes('hidden'),
    )
    const ids = new Set(inSight.map((u) => u.id))
    const before = seenDanger.current
    seenDanger.current = ids
    if (before === null || mode === 'off' || !alertKinds.sighting) return
    const arrived = inSight.filter((u) => !before.has(u.id))
    if (!arrived.length) return
    tell(
      `Danger in sight: ${creatureCounts(arrived)}`,
      'Hostile creatures have been spotted on the map.',
      true,
      'fort-danger',
    )
  }, [all, mode, alertKinds.sighting, tell])

  return null
}
