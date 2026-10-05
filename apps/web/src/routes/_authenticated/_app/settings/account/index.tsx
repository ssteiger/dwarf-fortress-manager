import { Button } from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { DownloadIcon, LogOutIcon, UploadIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { logoutFn } from '~/lib/auth/server'
import { setAlertMode } from '~/lib/fortress/alerts'
import { clearStepProgress, stepProgressCount } from '~/lib/fortress/progress'
import { clearWatchLists, watchCount } from '~/lib/fortress/watch'
import { clearAllTrails, trailCount } from '~/lib/legends/trail'
import { resetPreferences } from '~/lib/preferences'
import { exportBackup, getBackupCounts, importBackup } from '~/lib/settings/backup'
import {
  BackupError,
  backupFileName,
  countBackup,
  describeCounts,
  describeImport,
  readBackup,
} from '~/lib/settings/backupFormat'
import { SettingRow, SettingsSection } from '../-components/SettingsSection'

interface LocalCounts {
  guides: number
  trail: number
  watched: number
}

function AccountSettingsPage() {
  const { user } = Route.useRouteContext()
  const client = useQueryClient()
  const [counts, setCounts] = React.useState<LocalCounts | null>(null)
  const refresh = React.useCallback(
    () => setCounts({ guides: stepProgressCount(), trail: trailCount(), watched: watchCount() }),
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
      </SettingsSection>

      <BackupSection />

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
        <SettingRow
          label="Dwarves you watch"
          description={
            counts?.watched
              ? `${counts.watched} ${counts.watched === 1 ? 'creature' : 'creatures'} on your watch lists, across all fortresses.`
              : 'You watch nobody. Pin a dwarf with Watch on their page.'
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!counts?.watched}
            onClick={() => {
              clearWatchLists()
              refresh()
              toast.success('Nobody is watched any more.')
            }}
          >
            Clear
          </Button>
        </SettingRow>
      </SettingsSection>
    </>
  )
}

const MAX_BACKUP_BYTES = 50 * 1024 * 1024

/** The player's own writing, saved to a file and read back, since `db:reset` wipes it. */
function BackupSection() {
  const client = useQueryClient()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const counts = useQuery({ queryKey: ['backup-counts'], queryFn: () => getBackupCounts() })
  const [result, setResult] = React.useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => exportBackup(),
    onSuccess: (backup) => {
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backupFileName(new Date())
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`Saved ${describeCounts(countBackup(backup)) ?? 'an empty backup'}.`)
    },
    onError: (error) => toast.error(`Could not save the backup: ${error.message}`),
  })

  const restore = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BACKUP_BYTES)
        throw new BackupError('This file is larger than any backup the app writes.')
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new BackupError('This file is not a backup from Dwarf Fortress Manager.')
      }
      readBackup(parsed)
      return importBackup({ data: parsed })
    },
    onSuccess: async (outcome) => {
      const text = describeImport(outcome)
      setResult(text)
      toast.success(text)
      await client.invalidateQueries()
    },
    onError: (error) => {
      setResult(null)
      toast.error(error.message)
    },
  })

  const held = counts.data ? describeCounts(counts.data) : null
  return (
    <SettingsSection
      title="Your writing"
      description="Your notes on creatures, the nicknames you gave and why, your name list and your legends journal. They are kept in the app’s database, which a database reset wipes, so save them to a file now and then."
    >
      <SettingRow
        label="Save to a file"
        description={
          counts.isPending
            ? 'Counting…'
            : held
              ? `You have ${held}.`
              : 'You have not written anything yet.'
        }
      >
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          <DownloadIcon className="size-3.5" />
          {save.isPending ? 'Saving…' : 'Export'}
        </Button>
      </SettingRow>
      <SettingRow
        label="Read back from a file"
        description="Adds what the file has and the app does not. A note is replaced only by a newer one, nothing is deleted, and nobody is renamed in the game."
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) restore.mutate(file)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={restore.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="size-3.5" />
          {restore.isPending ? 'Reading…' : 'Import'}
        </Button>
      </SettingRow>
      {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
    </SettingsSection>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings/account/')({
  component: AccountSettingsPage,
})
