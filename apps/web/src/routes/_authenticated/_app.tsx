import { AppLayout, type NavUserUser } from '@fortress/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { toast } from 'sonner'

import { logoutFn } from '~/lib/auth/server'

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
    <AppLayout
      headerProps={{ title: headerTitle(location.pathname) }}
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
    </AppLayout>
  )
}

export const Route = createFileRoute('/_authenticated/_app')({
  component: Layout,
})
