import { Badge, Button, Switch } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BellIcon, BellOffIcon, MonitorIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import {
  type AlertMode,
  desktopAlertsAllowed,
  enableDesktopAlerts,
  setAlertMode,
  useAlertMode,
} from '~/lib/fortress/alerts'
import {
  type AlertKind,
  DEFAULT_PREFERENCES,
  setPreference,
  usePreferences,
} from '~/lib/preferences'
import {
  type Choice,
  ChoiceGroup,
  SettingRow,
  SettingsSection,
} from '../-components/SettingsSection'

const MODES: Choice<AlertMode>[] = [
  {
    value: 'app',
    label: 'In the app',
    hint: 'A note in the corner while a tab is open',
    icon: BellIcon,
  },
  {
    value: 'desktop',
    label: 'On the desktop too',
    hint: 'A system notification while you are in the game',
    icon: MonitorIcon,
  },
  {
    value: 'off',
    label: 'Off',
    hint: 'Quiet. The chronicle still keeps it all',
    icon: BellOffIcon,
  },
]

const KINDS: { kind: AlertKind; label: string; what: string; urgent: boolean }[] = [
  { kind: 'death', label: 'Deaths', what: 'A citizen, pet or visitor dies.', urgent: true },
  {
    kind: 'threat',
    label: 'Danger',
    what: 'Sieges, ambushes, megabeasts, thieves, floods and cave-ins.',
    urgent: true,
  },
  {
    kind: 'sighting',
    label: 'Hostiles in sight',
    what: 'Hostile creatures come into view on the map.',
    urgent: true,
  },
  {
    kind: 'mood',
    label: 'Moods and breakdowns',
    what: 'Strange moods, tantrums, and dwarves going berserk or insane.',
    urgent: true,
  },
  {
    kind: 'artifact',
    label: 'Artifacts',
    what: 'A dwarf in a mood finishes a legendary artifact.',
    urgent: false,
  },
  {
    kind: 'arrival',
    label: 'Arrivals and departures',
    what: 'Migrants, caravans, diplomats, visitors and petitioners.',
    urgent: false,
  },
  { kind: 'birth', label: 'Births', what: 'A baby is born, or a child grows up.', urgent: false },
  {
    kind: 'society',
    label: 'Nobles and family',
    what: 'Appointments, elections, mandates and marriages.',
    urgent: false,
  },
]

type Permission = NotificationPermission | 'unsupported'

function useNotificationPermission(): [Permission, () => void] {
  const [permission, setPermission] = React.useState<Permission>('default')
  const refresh = React.useCallback(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])
  React.useEffect(refresh, [])
  return [permission, refresh]
}

const PERMISSION_NOTE: Record<Permission, string> = {
  granted: 'Your browser allows notifications from this site.',
  default: 'Your browser will ask for permission when you choose it.',
  denied:
    'Your browser blocks notifications from this site. Allow them in the site settings (the icon left of the address), then choose it again.',
  unsupported: 'This browser cannot show desktop notifications.',
}

function AlertSettingsPage() {
  const mode = useAlertMode()
  const { alertKinds } = usePreferences()
  const [permission, refreshPermission] = useNotificationPermission()
  const off = mode === 'off'
  const enabled = KINDS.filter((k) => alertKinds[k.kind]).length

  const chooseMode = async (next: AlertMode) => {
    if (next !== 'desktop') {
      setAlertMode(next)
      return
    }
    const granted = await enableDesktopAlerts()
    refreshPermission()
    if (!granted) toast.error('The browser did not allow notifications, so alerts stay in the app.')
  }

  const setKind = (kind: AlertKind, on: boolean) =>
    setPreference('alertKinds', { ...alertKinds, [kind]: on })

  const sendTest = () => {
    toast('Test alert', {
      description: 'This is how the fortress will speak up.',
      duration: 6_000,
    })
    if (mode === 'desktop' && desktopAlertsAllowed())
      new Notification('Dwarf Fortress Manager', {
        body: 'Test alert: this is how the fortress will speak up.',
        tag: 'fort-test',
      })
  }

  return (
    <>
      <SettingsSection
        title="How you are told"
        description="The app watches the fortress from any page and speaks up when something happens. Only while it is open in a tab."
        action={
          <Button size="sm" variant="outline" onClick={sendTest} disabled={off}>
            Send a test
          </Button>
        }
      >
        <ChoiceGroup
          name="alert-mode"
          label="Alerts"
          value={mode}
          choices={MODES}
          onChange={chooseMode}
        />
        <p className="text-sm text-muted-foreground">{PERMISSION_NOTE[permission]}</p>
      </SettingsSection>

      <SettingsSection
        title="What is worth an alert"
        description={
          <>
            {enabled} of {KINDS.length} kinds. Everything else still lands in the{' '}
            <Link to="/fortress/chronicle" className="underline underline-offset-4">
              chronicle
            </Link>{' '}
            and on the overview.
          </>
        }
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPreference('alertKinds', DEFAULT_PREFERENCES.alertKinds)}
            disabled={enabled === KINDS.length}
          >
            Turn all on
          </Button>
        }
      >
        {KINDS.map(({ kind, label, what, urgent }) => (
          <SettingRow
            key={kind}
            id={`alert-${kind}`}
            label={label}
            description={
              <>
                {what}{' '}
                {urgent ? (
                  <Badge
                    variant="outline"
                    className="ml-1 border-red-500/40 align-middle text-red-600 dark:text-red-400"
                  >
                    Urgent
                  </Badge>
                ) : null}
              </>
            }
          >
            <Switch
              id={`alert-${kind}`}
              checked={alertKinds[kind]}
              disabled={off}
              onCheckedChange={(on) => setKind(kind, on)}
            />
          </SettingRow>
        ))}
      </SettingsSection>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings/notifications/')({
  component: AlertSettingsPage,
})
