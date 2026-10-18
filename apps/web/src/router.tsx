import { APP_SCROLL_ID } from '@fortress/ui'
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { DefaultCatchBoundary } from '~/lib/components/DefaultCatchBoundary'
import { DefaultPending } from '~/lib/components/DefaultPending'
import { NotFound } from '~/lib/components/NotFound'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
      },
    },
  })

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient, user: null },
    defaultPreload: 'intent',
    // react-query handles data fetching & caching
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultPendingComponent: DefaultPending,
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
    scrollToTopSelectors: [`#${APP_SCROLL_ID}`],
    defaultStructuralSharing: true,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}
