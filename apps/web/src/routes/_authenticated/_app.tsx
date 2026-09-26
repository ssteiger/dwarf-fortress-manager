import { AppLayout, type NavUserUser } from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import {
  BookOpenIcon,
  ClipboardListIcon,
  DatabaseIcon,
  HammerIcon,
  LibraryIcon,
  MapIcon,
  MountainIcon,
  PackageIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { AssistantBar } from '~/lib/assistant/AssistantBar'
import { AssistantProvider } from '~/lib/assistant/AssistantProvider'
import { logoutFn } from '~/lib/auth/server'
import { type EdgeDwarf, EdgeDwarves } from '~/lib/components/EdgeDwarves'
import { GlobalSearch } from '~/lib/components/GlobalSearch'
import { FortWatcher } from '~/lib/fortress/FortWatcher'
import { ReadGameButton } from '~/lib/fortress/ReadGameButton'
import { isLiving, unitGroup } from '~/lib/fortress/format'
import { getFortUnits } from '~/lib/fortress/server'
import { usePreferences, usePreferencesSync } from '~/lib/preferences'

const EDGE_DWARF_COUNT = 12

/** A dozen of the fortress's living citizens, the same dozen from one dump to the next. */
function FortressEdgeDwarves() {
  const { data } = useQuery({
    queryKey: ['fort', 'units'],
    queryFn: () => getFortUnits(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const dwarves = React.useMemo<EdgeDwarf[]>(
    () =>
      (data?.units ?? [])
        .filter(
          (u) =>
            u.race_id && isLiving(u) && unitGroup(u) === 'citizen' && !u.flags.includes('baby'),
        )
        .sort((a, b) => (Math.imul(a.id, 2654435761) >>> 0) - (Math.imul(b.id, 2654435761) >>> 0))
        .slice(0, EDGE_DWARF_COUNT)
        .map((u) => ({
          key: u.id,
          name: u.nickname || u.name.split(' ')[0] || u.readable,
          unit: u,
        })),
    [data],
  )
  return <EdgeDwarves dwarves={dwarves} />
}

const NAV = [
  { title: 'Overview', url: '/fortress', icon: MountainIcon },
  { title: 'Dwarves', url: '/fortress/dwarves', icon: UsersIcon, matchPrefix: true },
  { title: 'Items', url: '/fortress/items', icon: PackageIcon },
  { title: 'Work', url: '/fortress/work', icon: HammerIcon },
  { title: 'Map', url: '/fortress/map', icon: MapIcon },
  { title: 'Chronicle', url: '/fortress/chronicle', icon: ScrollTextIcon },
  { title: 'Legends', url: '/legends', icon: BookOpenIcon, matchPrefix: true },
  { title: 'Nickname Dwarves', url: '/nickname-dwarves', icon: LibraryIcon },
]

function headerTitle(pathname: string): string {
  if (pathname.startsWith('/legends')) return 'Legends'
  if (pathname.startsWith('/fortress')) return 'Fortress'
  if (pathname.startsWith('/activity-logs')) return 'Worker logs'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'Fortress'
}

const Layout = () => {
  const { user } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { edgeDwarves } = usePreferences()
  usePreferencesSync()

  const logOutMutation = useMutation({
    mutationFn: logoutFn,
    onSuccess: async () => {
      toast.success('Logout successful')
      await queryClient.invalidateQueries({ queryKey: ['user'] })
    },
    onError: (error) => {
      toast.error(`Logout failed: ${error.message}`)
    },
  })

  const sidebarUser: NavUserUser | undefined = user
    ? {
        name: user.email ?? 'Account',
        email: user.email ?? '',
        initials: (user.email ?? 'U').slice(0, 2).toUpperCase(),
      }
    : undefined

  return (
    <AssistantProvider>
      <AppLayout
        headerProps={{
          title: headerTitle(location.pathname),
          center: (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <GlobalSearch />
              </div>
              <AssistantBar />
            </div>
          ),
          end: <ReadGameButton />,
        }}
        sidebarProps={{
          brand: '☺ Dwarf Fortress Manager',
          brandHref: '/fortress',
          user: sidebarUser,
          onLogout: () => logOutMutation.mutate(undefined),
          navMain: NAV,
          documents: [],
          navSecondary: [
            { title: 'Worker logs', url: '/activity-logs', icon: ClipboardListIcon },
            { title: 'Settings', url: '/settings', icon: SettingsIcon },
          ],
          userMenuItems: [
            {
              label: 'Local DB',
              icon: DatabaseIcon,
              href: 'http://127.0.0.1:54423/project/default',
              external: true,
            },
          ],
        }}
      >
        <Outlet />
        {edgeDwarves && <FortressEdgeDwarves />}
        <FortWatcher />
      </AppLayout>
    </AssistantProvider>
  )
}

export const Route = createFileRoute('/_authenticated/_app')({
  component: Layout,
})
