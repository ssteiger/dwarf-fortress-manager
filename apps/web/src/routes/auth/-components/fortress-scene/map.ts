/**
 * The cave the sign-in dwarves live in: solid rock with a hall carved out of
 * the lower part, a tunnel leading off the edge, a campfire, a few stores,
 * and veins of ore and gems in the walls. Deterministic for a given size so
 * the layout does not jump between renders.
 */

export type Vein = 'gold' | 'copper' | 'silver' | 'emerald' | 'sapphire' | 'ruby' | 'amethyst'

export type PropKind = 'barrel' | 'bin' | 'anvil' | 'coins' | 'boulder'

export interface Prop {
  c: number
  r: number
  kind: PropKind
}

export interface Pos {
  c: number
  r: number
}

export interface SceneMap {
  cols: number
  rows: number
  /** 1 = floor, 0 = rock, row-major. */
  floor: Uint8Array
  veins: Map<number, Vein>
  props: Prop[]
  fire: Pos
  /** Last tunnel cell at the edge of the panel, where dwarves come and go. */
  exit: Pos
  /** Rows the miner may dig into; keeps the text areas solid. */
  digTop: number
  digBottom: number
}

export const ORE_VEINS: Vein[] = ['gold', 'copper', 'silver']
export const GEM_VEINS: Vein[] = ['emerald', 'sapphire', 'ruby', 'amethyst']

export function hash(c: number, r: number, salt = 0): number {
  let h =
    Math.imul(c + 1, 374761393) ^ Math.imul(r + 1, 668265263) ^ Math.imul(salt + 1, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function idx(map: Pick<SceneMap, 'cols'>, c: number, r: number): number {
  return r * map.cols + c
}

export function inBounds(map: Pick<SceneMap, 'cols' | 'rows'>, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < map.cols && r < map.rows
}

export function isFloor(map: SceneMap, c: number, r: number): boolean {
  return inBounds(map, c, r) && map.floor[idx(map, c, r)] === 1
}

function propAt(map: SceneMap, c: number, r: number): boolean {
  return map.props.some((p) => p.c === c && p.r === r)
}

export function isWalkable(map: SceneMap, c: number, r: number): boolean {
  if (!isFloor(map, c, r)) return false
  if (map.fire.c === c && map.fire.r === r) return false
  return !propAt(map, c, r)
}

const DIRS8: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function neighbours(map: SceneMap, c: number, r: number): Pos[] {
  const out: Pos[] = []
  for (const [dc, dr] of DIRS8) {
    const nc = c + dc
    const nr = r + dr
    if (!isWalkable(map, nc, nr)) continue
    // No squeezing diagonally past a wall corner.
    if (dc && dr && (!isWalkable(map, c + dc, r) || !isWalkable(map, c, r + dr))) continue
    out.push({ c: nc, r: nr })
  }
  return out
}

/** Shortest walk from `from` to `to`, excluding `from`; null when unreachable. */
export function findPath(map: SceneMap, from: Pos, to: Pos): Pos[] | null {
  if (from.c === to.c && from.r === to.r) return []
  const start = idx(map, from.c, from.r)
  const goal = idx(map, to.c, to.r)
  const prev = new Int32Array(map.cols * map.rows).fill(-1)
  prev[start] = start
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    if (cur === goal) break
    const c = cur % map.cols
    const r = Math.floor(cur / map.cols)
    for (const n of neighbours(map, c, r)) {
      const ni = idx(map, n.c, n.r)
      if (prev[ni] !== -1) continue
      prev[ni] = cur
      queue.push(ni)
    }
  }
  if (prev[goal] === -1) return null
  const path: Pos[] = []
  for (let cur = goal; cur !== start; cur = prev[cur]) {
    path.push({ c: cur % map.cols, r: Math.floor(cur / map.cols) })
  }
  return path.reverse()
}

function reachableSet(map: SceneMap, from: Pos): Set<number> {
  const seen = new Set([idx(map, from.c, from.r)])
  const queue = [...seen]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const n of neighbours(map, cur % map.cols, Math.floor(cur / map.cols))) {
      const ni = idx(map, n.c, n.r)
      if (seen.has(ni)) continue
      seen.add(ni)
      queue.push(ni)
    }
  }
  return seen
}

function walkableCount(map: SceneMap): number {
  let n = 0
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (isWalkable(map, c, r)) n++
  }
  return n
}

/** Rock cells a miner can reach from the hall. */
export function diggable(map: SceneMap): Pos[] {
  const out: Pos[] = []
  for (let r = map.digTop; r <= map.digBottom; r++) {
    for (let c = 1; c < map.cols - 1; c++) {
      if (isFloor(map, c, r)) continue
      const open =
        isWalkable(map, c + 1, r) ||
        isWalkable(map, c - 1, r) ||
        isWalkable(map, c, r + 1) ||
        isWalkable(map, c, r - 1)
      if (open) out.push({ c, r })
    }
  }
  return out
}

export function buildMap(cols: number, rows: number): SceneMap {
  const bottom = rows - 1 - Math.max(2, Math.round(rows * 0.18))
  const top = Math.min(Math.max(Math.round(rows * 0.3), 2), bottom - 2)
  const left = 1
  const right = cols - 2
  const fire = { c: Math.round((left + right) / 2), r: Math.round((top + bottom) / 2) }
  const exitRow = Math.min(bottom, fire.r + 1)
  const map: SceneMap = {
    cols,
    rows,
    floor: new Uint8Array(cols * rows),
    veins: new Map(),
    props: [],
    fire,
    exit: { c: cols - 1, r: exitRow },
    digTop: Math.max(1, top - 2),
    digBottom: Math.min(rows - 2, bottom + 1),
  }

  // Ragged walls only when the hall is tall enough to stay in one piece.
  const ragged = bottom - top >= 4
  for (let c = left; c <= right; c++) {
    const edge = c === left || c === right
    const colTop = top + (edge ? 1 : 0) + (ragged && hash(c, 0, 1) > 0.62 ? 1 : 0)
    const colBottom = bottom - (edge ? 1 : 0) - (ragged && hash(c, 0, 2) > 0.7 ? 1 : 0)
    for (let r = colTop; r <= colBottom; r++) map.floor[idx(map, c, r)] = 1
  }
  for (let c = fire.c; c < cols; c++) map.floor[idx(map, c, exitRow)] = 1
  map.floor[idx(map, fire.c, fire.r)] = 1
  map.floor[idx(map, fire.c, fire.r - 1)] = 1

  // Pockets the tunnel cannot reach would strand whoever spawns there.
  const reached = reachableSet(map, map.exit)
  for (let i = 0; i < map.floor.length; i++) {
    if (map.floor[i] && !reached.has(i) && i !== idx(map, fire.c, fire.r)) map.floor[i] = 0
  }

  // Stores go against the walls, never where they would cut the hall in two.
  const wallSide: Pos[] = []
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (!isWalkable(map, c, r)) continue
      if (r === exitRow && c >= right - 1) continue
      if (Math.abs(c - fire.c) <= 1 && Math.abs(r - fire.r) <= 1) continue
      const byWall = !isFloor(map, c - 1, r) || !isFloor(map, c + 1, r) || !isFloor(map, c, r - 1)
      if (byWall) wallSide.push({ c, r })
    }
  }
  wallSide.sort((a, b) => hash(a.c, a.r, 3) - hash(b.c, b.r, 3))
  const kinds: PropKind[] = ['barrel', 'barrel', 'anvil', 'bin', 'coins', 'boulder']
  for (const spot of wallSide) {
    const kind = kinds[map.props.length]
    if (!kind) break
    map.props.push({ ...spot, kind })
    if (reachableSet(map, map.exit).size !== walkableCount(map)) map.props.pop()
  }

  const candidates = diggable(map).sort((a, b) => hash(a.c, a.r, 5) - hash(b.c, b.r, 5))
  const veinCount = Math.max(4, Math.round(candidates.length * 0.2))
  for (const cell of candidates.slice(0, veinCount)) {
    const pick = hash(cell.c, cell.r, 6)
    const vein =
      pick < 0.55
        ? ORE_VEINS[Math.floor(hash(cell.c, cell.r, 7) * ORE_VEINS.length)]
        : GEM_VEINS[Math.floor(hash(cell.c, cell.r, 8) * GEM_VEINS.length)]
    map.veins.set(idx(map, cell.c, cell.r), vein)
  }
  // A few more deeper in the rock, for sparkle.
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (isFloor(map, c, r) || map.veins.has(idx(map, c, r))) continue
      if (hash(c, r, 9) > 0.93) {
        const list = hash(c, r, 10) > 0.5 ? GEM_VEINS : ORE_VEINS
        map.veins.set(idx(map, c, r), list[Math.floor(hash(c, r, 11) * list.length)])
      }
    }
  }
  return map
}

/** Random walkable cell in the hall, avoiding `taken`. */
export function randomHallCell(map: SceneMap, taken: Set<number>, rand = Math.random): Pos | null {
  const cells: Pos[] = []
  for (let r = 0; r < map.rows; r++) {
    for (let c = 1; c < map.cols - 2; c++) {
      if (isWalkable(map, c, r) && !taken.has(idx(map, c, r))) cells.push({ c, r })
    }
  }
  return cells.length ? cells[Math.floor(rand() * cells.length)] : null
}

/** Floor cells next to `target` from which a dwarf can work on it. */
export function workSpots(map: SceneMap, target: Pos): Pos[] {
  return [
    { c: target.c, r: target.r + 1 },
    { c: target.c - 1, r: target.r },
    { c: target.c + 1, r: target.r },
    { c: target.c, r: target.r - 1 },
  ].filter((p) => isWalkable(map, p.c, p.r))
}
