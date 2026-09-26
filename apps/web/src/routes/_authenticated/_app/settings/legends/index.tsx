import { Alert, AlertDescription, AlertTitle, Badge, Button, Skeleton } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { CircleAlertIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { getNarratorStatus } from '~/lib/legends/narrator'
import { clearTrail, useTrail } from '~/lib/legends/trail'
import { type LegendsLibraryWorld, getLegendsLibrary } from '~/lib/settings/server'
import { SettingsSection } from '../-components/SettingsSection'

function WorldRow({ world, live }: { world: LegendsLibraryWorld; live: boolean }) {
  const trail = useTrail(world.id)
  const name = world.name ?? 'Unnamed world'
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/legends"
            search={{ world: world.id }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {name}
          </Link>
          {world.altName ? (
            <span className="text-sm text-muted-foreground">{world.altName}</span>
          ) : null}
          {live ? <Badge variant="secondary">Your fortress is here</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {world.records.toLocaleString()} records from {world.files}{' '}
          {world.files === 1 ? 'file' : 'files'} · imported{' '}
          {formatDistanceToNow(new Date(world.importedAt), { addSuffix: true })}
          {world.notes ? (
            <>
              {' · '}
              <Link
                to="/legends/journal"
                search={{ world: world.id }}
                className="underline underline-offset-4"
              >
                {world.notes} journal {world.notes === 1 ? 'note' : 'notes'}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={!trail.length}
        onClick={() => {
          clearTrail(world.id)
          toast.success(`Forgot what you read lately in ${name}.`)
        }}
        title="The “Recently read” list on the legends pages"
      >
        {trail.length ? `Clear ${trail.length} recently read` : 'Nothing read lately'}
      </Button>
    </li>
  )
}

function LegendsSettingsPage() {
  const library = useQuery({
    queryKey: ['settings', 'legends-library'],
    queryFn: () => getLegendsLibrary(),
  })
  const narrator = useQuery({
    queryKey: ['legends', 'narrator-status'],
    queryFn: () => getNarratorStatus(),
    staleTime: 5 * 60_000,
  })

  return (
    <>
      <SettingsSection
        title="Worlds"
        description="Every world exported from Legends mode. Your journal and reading trail are kept per world."
      >
        {library.data ? (
          library.data.worlds.length ? (
            <ul className="flex flex-col gap-2">
              {library.data.worlds.map((w) => (
                <WorldRow key={w.id} world={w} live={w.name === library.data.liveWorldName} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No worlds imported yet.</p>
          )
        ) : library.isError ? (
          <Alert variant="destructive">
            <CircleAlertIcon className="size-4" />
            <AlertTitle>Could not list the worlds</AlertTitle>
            <AlertDescription>{library.error.message}</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-20 rounded-lg" />
        )}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Adding a world, or a newer export of one</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Open the save in Legends mode and export the XML, or run{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">exportlegends</code> in DFHack
              for the fuller <code className="text-xs whitespace-nowrap">-legends_plus.xml</code> as
              well.
            </li>
            <li>
              Leave the files in the game folder (or the folder set as{' '}
              <code className="text-xs">DF_LEGENDS_DIR</code>).
            </li>
            <li>
              Restart the worker. It imports new files in the background when it starts; files it
              already has are skipped.
            </li>
          </ol>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Narrator"
        description="An optional AI storyteller that retells events in a chosen voice. It is only handed facts the app already shows and told to invent nothing."
      >
        {narrator.data ? (
          <div className="flex items-start gap-3">
            <SparklesIcon
              className={
                narrator.data.enabled
                  ? 'mt-0.5 size-4 text-primary'
                  : 'mt-0.5 size-4 text-muted-foreground'
              }
            />
            <div>
              <div className="font-medium">
                {narrator.data.enabled ? 'The narrator is on' : 'The narrator is off'}
              </div>
              <p className="text-sm text-muted-foreground">
                {narrator.data.enabled
                  ? `Using ${narrator.data.model} through ${narrator.data.provider === 'anthropic' ? 'Anthropic' : 'an OpenAI-compatible API'}. Look for “Narrate” on stories, records and the history page.`
                  : 'Every page keeps to its own plain prose. Nothing leaves your machine.'}
              </p>
            </div>
          </div>
        ) : (
          <Skeleton className="h-12 rounded-lg" />
        )}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">
            {narrator.data?.enabled ? 'Changing it' : 'Turning it on'}
          </h3>
          <p className="text-sm text-muted-foreground">
            Add these to <code className="text-xs">apps/web/.env</code> and restart the app. The key
            stays on the server.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            {`LEGENDS_NARRATOR_PROVIDER=openai   # or anthropic, or cursor
LEGENDS_NARRATOR_API_KEY=sk-...      # a cursor_... key for cursor
LEGENDS_NARRATOR_MODEL=gpt-4o-mini  # optional
# optional: a local OpenAI-compatible server (Ollama, LM Studio)
LEGENDS_NARRATOR_BASE_URL=http://localhost:11434/v1`}
          </pre>
        </div>
      </SettingsSection>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings/legends/')({
  component: LegendsSettingsPage,
})
