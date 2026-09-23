import { createFileRoute } from '@tanstack/react-router'

import { ItemSprite } from '~/lib/df-assets/components'
import { humanize } from '~/lib/fortress/format'
import { useFortItem, useFortOverview } from '~/lib/fortress/queries'
import { FortBreadcrumbs, PageHeader, StatusBanner } from '../-components/FortChrome'
import { ItemDetails, ItemStatusBadges, itemSubtitle } from './-components/ItemDetails'

function ItemPage() {
  const { id } = Route.useParams()
  const numericId = Number.parseInt(id, 10)
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortItem(numericId)
  const item = data?.item ?? null
  const title = item?.description ?? `Item #${id}`

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <FortBreadcrumbs
        items={[
          { label: 'Fortress', to: '/fortress' },
          { label: 'Items', to: '/fortress/items' },
          { label: title },
        ]}
      />

      <PageHeader
        eyebrow={item ? humanize(item.type) : 'Item'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {item ? (
              <ItemSprite
                item={item}
                size={96}
                className="rounded-md border bg-muted/40"
                title={`${title} as drawn in the game`}
              />
            ) : null}
            {title}
            {item ? <ItemStatusBadges flags={item.flags} className="text-sm font-normal" /> : null}
          </span>
        }
        description={item ? itemSubtitle(item) : undefined}
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />
      <ItemDetails itemId={numericId} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/items/$id')({
  component: ItemPage,
})
