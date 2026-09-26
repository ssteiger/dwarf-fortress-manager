import {
  DFHACK_ACTIONS,
  type DfhackActionSpec,
  UNIT_ACTIONS,
  isDfhackAction,
  isUnitAction,
} from '@fortress/db-drizzle/fortress-types'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { CircleAlertIcon, PlugZapIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { type DumpState, setDumpSchedule } from '~/lib/fortress/dump'
import { DUMP_STATE_KEY, useDumpState, useFortUnits, useTick } from '~/lib/fortress/queries'
import { setPreference, usePreferences } from '~/lib/preferences'
import {
  type ConnectionStatus,
  type WorkerCommand,
  cancelWaitingCommands,
  getConnectionStatus,
} from '~/lib/settings/server'
import { SettingRow, SettingsSection } from '../-components/SettingsSection'

const QUERY_KEY = ['settings', 'connection']

/**
 * Without a heartbeat to go on (a worker from before it had one), the last
 * dump is the only sign of life; at 30 s a dump, two minutes means it stopped.
 */
const QUIET_AFTER_MS = 2 * 60_000

const ago = (at: string | null) =>
  at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : 'never'

const STATUS: Record<
  NonNullable<ConnectionStatus['status']> | 'none',
  { label: string; hint: string; dot: string }
> = {
  live: {
    label: 'Connected to your fortress',
    hint: 'The worker is reading the game through DFHack.',
    dot: 'bg-emerald-500',
  },
  menu: {
    label: 'At the game menu',
    hint: 'DFHack answers, but no fortress is loaded. Load a save to follow along.',
    dot: 'bg-amber-500',
  },
  offline: {
    label: 'Game not reachable',
    hint: 'The worker is running but DFHack does not answer. Is Dwarf Fortress open?',
    dot: 'bg-red-500',
  },
  none: {
    label: 'No word from the worker yet',
    hint: 'Start it while the game runs and it reports here on its own.',
    dot: 'bg-muted-foreground',
  },
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  )
}

function StatusSection({ data, dump }: { data: ConnectionStatus; dump: DumpState | undefined }) {
  useTick(5000)
  const status = STATUS[data.status ?? 'none']
  const lastSign = dump?.workerSeenAt ?? data.reportedAt
  const quiet = dump?.workerSeenAt
    ? !dump.workerRunning
    : data.reportedAt !== null && Date.now() - new Date(data.reportedAt).getTime() > QUIET_AFTER_MS
  return (
    <SettingsSection
      title="Status"
      description="The worker runs next to the game, reads it through DFHack's remote interface and writes what it sees to the database."
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', status.dot)} />
        <div>
          <div className="font-medium">{status.label}</div>
          <p className="text-sm text-muted-foreground">
            {status.hint}
            {dump && !dump.auto && data.status
              ? ' Automatic reads are off, so this is how things stood at the last read.'
              : null}
          </p>
        </div>
      </div>

      {quiet ? (
        <Alert>
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>The worker has gone quiet</AlertTitle>
          <AlertDescription>
            <p>
              Its last sign of life was {ago(lastSign)}. What you see is from then. Start it again
              with <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code>.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {data.status === null ? (
        <Alert>
          <PlugZapIcon className="size-4" />
          <AlertTitle>Getting started</AlertTitle>
          <AlertDescription>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Start Dwarf Fortress with DFHack.</li>
              <li>
                Run <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code>{' '}
                from the project folder.
              </li>
              <li>Load your fortress. This page updates with the next read.</li>
            </ol>
          </AlertDescription>
        </Alert>
      ) : null}
      {data.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon className="size-4" />
          <AlertTitle>Last problem the worker reported</AlertTitle>
          <AlertDescription>
            <code className="text-xs break-all whitespace-pre-wrap">{data.error}</code>
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Fortress">{data.fortName}</Fact>
        <Fact label="World">{data.worldName}</Fact>
        <Fact label="In-game date">{data.gameDate}</Fact>
        <Fact label="Last report">
          {ago(data.reportedAt)}
          {data.elapsedMs ? (
            <span className="text-muted-foreground">
              {' '}
              · took {(data.elapsedMs / 1000).toFixed(1)} s
            </span>
          ) : null}
        </Fact>
        <Fact label="Dwarves, items and jobs">{ago(data.dumpAt)}</Fact>
        <Fact label="Map">
          {ago(data.mapAt)}
          {data.mapSize ? (
            <span className="text-muted-foreground">
              {' '}
              · {data.mapSize.x}×{data.mapSize.y}×{data.mapSize.z}
            </span>
          ) : null}
        </Fact>
        <Fact label="Chronicle">
          {data.eventCount.toLocaleString()} announcements
          {data.lastEventAt ? (
            <span className="text-muted-foreground"> · newest {ago(data.lastEventAt)}</span>
          ) : null}
        </Fact>
        <Fact label="Dwarf Fortress">{data.dfVersion}</Fact>
        <Fact label="DFHack">{data.dfhackVersion}</Fact>
        {data.saveDir ? (
          <Fact label="Save folder">
            <code className="text-xs">{data.saveDir}</code>
          </Fact>
        ) : null}
      </dl>
    </SettingsSection>
  )
}

const DUMP_INTERVALS_MS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000]

function everyLabel(ms: number): string {
  if (ms < 60_000) return `Every ${Math.round(ms / 1000)} seconds`
  if (ms === 60_000) return 'Every minute'
  const minutes = ms / 60_000
  return `Every ${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`
}

function ReadingSection({ dump }: { dump: DumpState }) {
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (next: { auto?: boolean; intervalMs?: number }) => setDumpSchedule({ data: next }),
    onMutate: (next) => {
      client.setQueryData<DumpState>(DUMP_STATE_KEY, (old) => (old ? { ...old, ...next } : old))
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: DUMP_STATE_KEY }),
  })
  // A frequency set through DF_POLL_MS may not be one of the choices; keep it on the list.
  const intervals = DUMP_INTERVALS_MS.includes(dump.intervalMs)
    ? DUMP_INTERVALS_MS
    : [...DUMP_INTERVALS_MS, dump.intervalMs].sort((a, b) => a - b)
  return (
    <SettingsSection
      title="Reading the game"
      description={
        <>
          Dwarf Fortress stands still while the worker copies the fortress out
          {dump.elapsedMs ? (
            <>
              : {(dump.elapsedMs / 1000).toFixed(1)} seconds the last time, longer when the map
              comes along
            </>
          ) : null}
          . Read less often if the pauses get in the way of playing.
        </>
      }
    >
      <SettingRow
        id="auto-dump"
        label="Read automatically"
        description={
          <>
            Off, the game is only read when you press{' '}
            <RefreshCwIcon className="inline size-3.5 align-[-0.125em]" aria-label="refresh" /> at
            the top right. Commands you send from the app still run, and show up after the next
            read.
          </>
        }
      >
        <Switch
          id="auto-dump"
          checked={dump.auto}
          onCheckedChange={(on) => save.mutate({ auto: on })}
        />
      </SettingRow>
      <SettingRow
        id="dump-interval"
        label="How often"
        description="How long the game runs freely between the end of one read and the start of the next."
      >
        <Select
          value={String(dump.intervalMs)}
          onValueChange={(value) => save.mutate({ intervalMs: Number(value) })}
          disabled={!dump.auto}
        >
          <SelectTrigger id="dump-interval" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {intervals.map((ms) => (
              <SelectItem key={ms} value={String(ms)}>
                {everyLabel(ms)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      {dump.workerSeenAt && !dump.workerRunning ? (
        <p className="text-sm text-muted-foreground">
          The worker is not running. It picks up these settings when it starts.
        </p>
      ) : null}
    </SettingsSection>
  )
}

function commandLabel(c: WorkerCommand, names: Map<number, string>): React.ReactNode {
  if (c.kind === 'dfhack') {
    const spec: DfhackActionSpec | undefined = isDfhackAction(c.action)
      ? DFHACK_ACTIONS[c.action]
      : undefined
    return spec ? spec.label : `DFHack: ${c.action ?? 'unknown'}`
  }
  const who =
    c.unitId !== null ? (
      <Link
        to="/fortress/dwarves/$id"
        params={{ id: String(c.unitId) }}
        className="underline underline-offset-4"
      >
        {names.get(c.unitId) ?? `unit ${c.unitId}`}
      </Link>
    ) : (
      'a dwarf'
    )
  if (c.kind === 'unit_action') {
    if (c.action === 'title')
      return c.arg ? (
        <>
          Titled {who} “{c.arg}”
        </>
      ) : (
        <>Cleared the title of {who}</>
      )
    return (
      <>
        {isUnitAction(c.action) ? UNIT_ACTIONS[c.action].label : c.action}: {who}
      </>
    )
  }
  return c.nickname ? (
    <>
      Nicknamed {who} “{c.nickname}”
    </>
  ) : (
    <>Cleared the nickname of {who}</>
  )
}

const SHOWN_COMMANDS = 8

const COMMAND_STATUS: Record<
  WorkerCommand['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: 'Waiting', variant: 'outline' },
  processing: { label: 'Running', variant: 'secondary' },
  done: { label: 'Done', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
}

function CommandsSection({ commands }: { commands: WorkerCommand[] }) {
  const client = useQueryClient()
  const units = useFortUnits()
  const names = React.useMemo(
    () => new Map((units.data?.units ?? []).map((u) => [u.id, u.name || u.readable])),
    [units.data],
  )
  const [showAll, setShowAll] = React.useState(false)
  const shown = showAll ? commands : commands.slice(0, SHOWN_COMMANDS)
  const waiting = commands.filter((c) => c.status === 'pending').length
  const cancel = useMutation({
    mutationFn: () => cancelWaitingCommands(),
    onSuccess: ({ cancelled }) => {
      toast.success(
        cancelled === 1
          ? 'Cancelled 1 waiting command.'
          : `Cancelled ${cancelled} waiting commands.`,
      )
      void client.invalidateQueries({ queryKey: QUERY_KEY })
      void client.invalidateQueries({ queryKey: ['fort', 'dfhack-runs'] })
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <SettingsSection
      title="Recent commands"
      description="Nicknames and DFHack commands sent from the app, newest first."
      action={
        waiting ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
          >
            Cancel {waiting} waiting
          </Button>
        ) : null
      }
    >
      {waiting ? (
        <p className="text-sm text-muted-foreground">
          Waiting commands run as soon as the worker picks them up, even hours later. Cancel them if
          the worker was off and you no longer want them.
        </p>
      ) : null}
      {commands.length ? (
        <ul className="flex flex-col divide-y">
          {shown.map((c) => {
            const status = COMMAND_STATUS[c.status]
            return (
              <li key={c.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <span className="text-sm font-medium">{commandLabel(c, names)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {ago(c.completedAt ?? c.createdAt)}
                  </span>
                </div>
                {c.error ? <p className="text-sm text-destructive">{c.error}</p> : null}
                {c.output?.trim() ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      What DFHack said
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                      {c.output.trim()}
                    </pre>
                  </details>
                ) : null}
              </li>
            )
          })}
          {commands.length > SHOWN_COMMANDS ? (
            <li className="pt-2.5">
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${commands.length}`}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing sent yet. Guides on the overview and work pages offer commands where they help.
        </p>
      )}
    </SettingsSection>
  )
}

const WORKER_ENV: { name: string; fallback: string; what: string }[] = [
  {
    name: 'DF_GAME_DIR',
    fallback: 'The Steam copy in the CrossOver bottle',
    what: 'The folder with Dwarf Fortress in it.',
  },
  {
    name: 'DF_LEGENDS_DIR',
    fallback: 'The game folder',
    what: 'Where to look for legends exports (*-legends.xml).',
  },
  {
    name: 'DFHACK_HOST',
    fallback: '127.0.0.1',
    what: "The machine DFHack's remote interface runs on.",
  },
  { name: 'DFHACK_PORT', fallback: '5000', what: "DFHack's remote port." },
  {
    name: 'DF_POLL_MS',
    fallback: '30000 (30 s)',
    what: 'How often the game is read on the worker’s first run. After that, the choice under Reading the game wins.',
  },
  {
    name: 'DF_MAP_POLL_MS',
    fallback: '300000 (5 min)',
    what: 'How often the map is read. Each read pauses the game for a moment.',
  },
  {
    name: 'DF_COMMAND_POLL_MS',
    fallback: '2000 (2 s)',
    what: 'How quickly queued commands, refresh requests and changes above are picked up.',
  },
  {
    name: 'DF_IMPORT_LEGENDS',
    fallback: 'on',
    what: 'Set to 0 to skip importing legends exports.',
  },
]

function ConnectionSettingsPage() {
  const { oneClickActions } = usePreferences()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getConnectionStatus(),
    refetchInterval: 5_000,
  })
  const dump = useDumpState()

  return (
    <>
      {query.data ? (
        <StatusSection data={query.data} dump={dump.data} />
      ) : query.isError ? (
        <Alert variant="destructive">
          <CircleAlertIcon className="size-4" />
          <AlertTitle>Could not read the connection status</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      ) : (
        <Skeleton className="h-72 rounded-xl" />
      )}

      {dump.data ? (
        <ReadingSection dump={dump.data} />
      ) : dump.isError ? (
        <Alert variant="destructive">
          <CircleAlertIcon className="size-4" />
          <AlertTitle>Could not read when the worker reads the game</AlertTitle>
          <AlertDescription>{dump.error.message}</AlertDescription>
        </Alert>
      ) : (
        <Skeleton className="h-48 rounded-xl" />
      )}

      <SettingsSection
        title="Commands from the app"
        description="Some guides can fix things in the game for you. The worker only runs the commands below, never anything typed in."
      >
        <SettingRow
          id="one-click"
          label="One-click DFHack commands"
          description="Off shows each command to copy into the DFHack console yourself instead."
        >
          <Switch
            id="one-click"
            checked={oneClickActions}
            onCheckedChange={(on) => setPreference('oneClickActions', on)}
          />
        </SettingRow>
        <ul className="flex flex-col gap-2">
          {Object.values(DFHACK_ACTIONS).map((spec: DfhackActionSpec) => (
            <li key={spec.label} className="flex flex-col gap-0.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{spec.label}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {[spec.command, ...spec.args].join(' ')}
                </code>
                {spec.confirm ? <Badge variant="outline">Asks first</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{spec.what}</p>
            </li>
          ))}
        </ul>
      </SettingsSection>

      {query.data ? <CommandsSection commands={query.data.commands} /> : null}

      <SettingsSection
        title="Worker settings"
        description={
          <>
            Set these in <code className="text-xs">apps/worker/.env</code>. The worker picks up
            changes when it restarts.
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variable</TableHead>
              <TableHead>What it does</TableHead>
              <TableHead>Default</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {WORKER_ENV.map((v) => (
              <TableRow key={v.name}>
                <TableCell>
                  <code className="text-xs">{v.name}</code>
                </TableCell>
                <TableCell>{v.what}</TableCell>
                <TableCell className="text-muted-foreground">{v.fallback}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsSection>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings/connection/')({
  component: ConnectionSettingsPage,
})
