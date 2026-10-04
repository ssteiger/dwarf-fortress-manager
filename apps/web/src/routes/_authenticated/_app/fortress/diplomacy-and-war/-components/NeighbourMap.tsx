import type { FortPower } from '@fortress/db-drizzle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@fortress/ui'
import { MapIcon } from 'lucide-react'

import {
  STANCE_FILL,
  type Stance,
  type StanceTone,
  powerName,
  siteText,
} from '~/lib/fortress/diplomacy'
import type { OpenPower } from './shared'

const RINGS = [10, 25, 50, 100, 200, 400]

const LEGEND: { tone: StanceTone; label: string }[] = [
  { tone: 'good', label: 'Your civilization, allies, tributaries' },
  { tone: 'calm', label: 'At peace' },
  { tone: 'warn', label: 'Hostile by nature, or you pay tribute' },
  { tone: 'danger', label: 'At war' },
  { tone: 'muted', label: 'No contact' },
]

/** Map radius in world tiles: enough for every shown power's nearest site, in round tens. */
export function mapRadius(powers: FortPower[]): number {
  const far = Math.max(25, ...powers.map((p) => p.distance ?? 0))
  return Math.min(400, Math.ceil((far + 2) / 10) * 10)
}

/** The fortress at the centre, every listed holding around it, north up. */
export function NeighbourMap({
  powers,
  stances,
  selectedId,
  onOpen,
}: {
  powers: FortPower[]
  stances: Map<number, Stance>
  selectedId: number | null
  onOpen: OpenPower
}) {
  const R = mapRadius(powers)
  const pad = R * 0.12
  const span = 2 * (R + pad)
  const at = (v: number) => `${((v + R + pad) / span) * 100}%`
  const font = R / 18
  const dots = powers
    .flatMap((power) =>
      power.sites
        .filter((site) => site.distance <= R)
        .map((site) => ({ power, site, tone: stances.get(power.id)?.tone ?? 'muted' })),
    )
    .sort(
      (a, b) =>
        Number(a.power.id === selectedId) - Number(b.power.id === selectedId) ||
        Number(a.site.settlement) - Number(b.site.settlement),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="size-4 text-primary" />
          The neighbourhood
        </CardTitle>
        <CardDescription>
          Your fortress in the middle, north up. Large dots are settlements, small ones tombs, lairs
          and camps, coloured by how their owner stands with you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative mx-auto aspect-square w-full max-w-[30rem]">
          <svg
            viewBox={`${-R - pad} ${-R - pad} ${span} ${span}`}
            className="absolute inset-0 size-full text-muted-foreground"
            role="img"
            aria-label="Map of the settlements around your fortress"
          >
            <line
              x1={-R}
              y1={0}
              x2={R}
              y2={0}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={R / 400}
            />
            <line
              x1={0}
              y1={-R}
              x2={0}
              y2={R}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={R / 400}
            />
            {RINGS.filter((ring) => ring <= R).map((ring) => (
              <g key={ring}>
                <rect
                  x={-ring}
                  y={-ring}
                  width={2 * ring}
                  height={2 * ring}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.25}
                  strokeDasharray={`${R / 80} ${R / 80}`}
                  strokeWidth={R / 400}
                />
                <text
                  x={ring - font * 0.3}
                  y={-ring + font * 1.1}
                  textAnchor="end"
                  fontSize={font * 0.75}
                  fill="currentColor"
                >
                  {ring} tiles
                </text>
              </g>
            ))}
            {(
              [
                ['N', 0, -R - pad / 2],
                ['S', 0, R + pad / 2],
                ['E', R + pad / 2, 0],
                ['W', -R - pad / 2, 0],
              ] as const
            ).map(([label, x, y]) => (
              <text
                key={label}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={font}
                fontWeight={600}
                fill="currentColor"
              >
                {label}
              </text>
            ))}

            <rect
              x={-R / 50}
              y={-R / 50}
              width={R / 25}
              height={R / 25}
              transform="rotate(45)"
              fill="var(--foreground, #000)"
            >
              <title>Your fortress</title>
            </rect>
          </svg>
          {dots.map(({ power, site, tone }) => {
            const selected = power.id === selectedId
            const size = (site.settlement ? 12 : 7) + (selected ? 4 : 0)
            const label = `${siteText(site)}. Held by ${powerName(power)}.`
            return (
              <button
                key={`${power.id}-${site.id}`}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onOpen(power.id)}
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-2 border-foreground' : 'border border-background',
                )}
                style={{
                  left: at(site.dx),
                  top: at(site.dy),
                  width: size,
                  height: size,
                  backgroundColor: STANCE_FILL[tone],
                  opacity: site.settlement || selected ? 0.95 : 0.6,
                }}
              />
            )
          })}
        </div>

        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {LEGEND.map((entry) => (
            <li key={entry.tone} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: STANCE_FILL[entry.tone] }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
