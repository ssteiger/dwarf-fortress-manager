import { Badge, cn } from '@fortress/ui'
import { ChevronRightIcon } from 'lucide-react'
import * as React from 'react'

/** A titled band of a flat page: no card around it, the hairlines between bands stand in for edges. */
export function Section({
  title,
  icon,
  count,
  description,
  action,
  collapsed = false,
  bleed = false,
  anchor,
  className,
  children,
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  count?: number | null
  description?: React.ReactNode
  /** At the right of the title row. */
  action?: React.ReactNode
  /** Start closed. The title row is the disclosure control. */
  collapsed?: boolean
  /** The body runs edge to edge and to the bottom, for tables and maps; the title row keeps its padding. */
  bleed?: boolean
  /** Element id, for in-page links to this band. */
  anchor?: string
  className?: string
  children?: React.ReactNode
}) {
  const id = React.useId()
  const head = (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-base leading-none font-medium">
          {collapsed ? (
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          ) : null}
          {icon}
          {title}
          {typeof count === 'number' ? (
            <Badge variant="secondary" className="tabular-nums">
              {count.toLocaleString()}
            </Badge>
          ) : null}
        </h2>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
  if (collapsed) {
    return (
      <section id={anchor} aria-labelledby={id} className={cn('scroll-mt-4', className)}>
        <details className="group">
          <summary className="cursor-pointer list-none p-4 select-none [&::-webkit-details-marker]:hidden">
            {head}
          </summary>
          <div className={cn('flex flex-col gap-4', !bleed && 'px-4 pb-4')}>{children}</div>
        </details>
      </section>
    )
  }
  return (
    <section
      id={anchor}
      aria-labelledby={id}
      className={cn(
        'flex scroll-mt-4 flex-col gap-4 pt-4',
        bleed ? 'pb-0' : 'px-4 pb-4',
        className,
      )}
    >
      {bleed ? <div className="px-4">{head}</div> : head}
      {children}
    </section>
  )
}

/** Bands stacked down the page, a hairline between each. */
export function SectionStack({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-col divide-y', className)} {...props} />
}

/**
 * Bands side by side, a hairline between cells. Each cell draws its right and
 * bottom rule; the grid clips the ones on its outer edges, so a short last row
 * leaves no grey gap. Pass the column classes.
 */
export function SectionGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn(SECTION_GRID, className)} {...props} />
}

/** The classes of `SectionGrid`, for a grid that has to be another element, such as a list. */
export const SECTION_GRID =
  'grid overflow-clip *:min-w-0 *:shadow-[1px_0_0_var(--color-border),0_1px_0_var(--color-border)]'
