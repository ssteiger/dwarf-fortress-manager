import { Button } from '@fortress/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { LogOutIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { logoutFn } from '~/lib/auth/server'
import { setAlertMode } from '~/lib/fortress/alerts'
import { clearStepProgress, stepProgressCount } from '~/lib/fortress/progress'
import { clearAllTrails, trailCount } from '~/lib/legends/trail'
import { resetPreferences } from '~/lib/preferences'
import { SettingRow, SettingsSection } from '../-components/SettingsSection'

interface LocalCounts {
  guides: number
  trail: number
}

function AccountSettingsPage() {
  const { user } = Route.useRouteContext()
  const client = useQueryClient()
  const [counts, setCounts] = React.useState<LocalCounts | null>(null)
  const refresh = React.useCallback(
    () => setCounts({ guides: stepProgressCount(), trail: trailCount() }),
    [],
  )
  React.useEffect(refresh, [])

  const signOut = useMutation({
    mutationFn: logoutFn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['user'] })
    },
    onError: (error) => toast.error(`Could not sign out: ${error.message}`),
  })

  return (
    <>
      <SettingsSection
        title="Signed in"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => signOut.mutate(undefined)}
            disabled={signOut.isPending}
            className="gap-1.5"
          >
            <LogOutIcon className="size-3.5" />
            Sign out
          </Button>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="text-sm break-all">{user?.email ?? '—'}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Member since</dt>
            <dd className="text-sm">
              {user?.created_at ? format(new Date(user.created_at), 'd MMMM yyyy') : '—'}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          Your legends journal is saved with your account. Everything below lives in this browser
          only.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Saved in this browser"
        description="Handy when a checklist is stuck half-done, or to start over on a new fortress."
      >
        <SettingRow
          label="Display and alert choices"
          description="Theme, text size, motion, walking dwarves, one-click commands and which alerts you get."
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              resetPreferences()
              setAlertMode('app')
              toast.success('Back to the defaults.')
            }}
          >
            Reset to defaults
          </Button>
        </SettingRow>
        <SettingRow
          label="Guide checklists"
          description={
            counts?.guides
              ? `Steps ticked off in ${counts.guides} ${counts.guides === 1 ? 'guide' : 'guides'} on the overview and work pages.`
              : 'No steps ticked off in any guide.'
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!counts?.guides}
            onClick={() => {
              clearStepProgress()
              refresh()
              toast.success('Every checklist starts from step one again.')
            }}
          >
            Clear
          </Button>
        </SettingRow>
        <SettingRow
          label="Recently read in legends"
          description={
            counts?.trail
              ? `${counts.trail} ${counts.trail === 1 ? 'record' : 'records'} on your reading trail, across all worlds.`
              : 'Your reading trail is empty.'
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!counts?.trail}
            onClick={() => {
              clearAllTrails()
              refresh()
              toast.success('Reading trail cleared.')
            }}
          >
            Clear
          </Button>
        </SettingRow>
      </SettingsSection>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings/account/')({
  component: AccountSettingsPage,
})
