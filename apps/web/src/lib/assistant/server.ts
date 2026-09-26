import {
  type FortBuilding,
  type FortEvent,
  type FortJob,
  type FortStatus,
  type FortSummary,
  type FortUnit,
  type FortWorld,
  STRESS_LABELS,
  checkConsoleCommand,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { complete, readModelConfig } from '~/lib/ai/model'
import {
  type Advice,
  compact,
  fmt,
  fortAdvice,
  jobQueue,
  plural,
  workshopBoard,
} from '~/lib/fortress/advisor'
import { formatGameTick, skillRank } from '~/lib/fortress/format'
import { firstName, gameTimeOf } from '~/lib/fortress/insights'
import { type FortSupplies, getFortConcerns, getFortSupplies } from '~/lib/fortress/server'
import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

/*
 * The assistant in the header: a language model that answers questions about
 * playing Dwarf Fortress, with a summary of the fortress as the app last read
 * it. DFHack commands it suggests come back as separate parts, which the
 * player can run one at a time after reading and confirming them.
 */

const SINGLETON_ID = 1
const MAX_QUESTION = 1000
const MAX_TURNS = 8
const MAX_TURN = 3000
const C = schema.fort_commands

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('Sign in to ask the assistant')
  return user
}

// ---------------------------------------------------------------------------
// Status

export interface AssistantStatus {
  enabled: boolean
  model: string | null
}

export const getAssistantStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AssistantStatus> => {
    await requireUser()
    const config = readModelConfig()
    return { enabled: Boolean(config), model: config?.model ?? null }
  },
)

// ---------------------------------------------------------------------------
// What the model is told about the fortress

interface FortressBrief {
  lines: string[]
  status: FortStatus | null
}

const ADVICE_SHOWN = 10
const JOBS_SHOWN = 12

function describeSummary(summary: FortSummary): string[] {
  const moods = summary.mood
    .map((n, i) => (n ? `${n} ${STRESS_LABELS[i]}` : ''))
    .filter(Boolean)
    .join(', ')
  return [
    `Citizens: ${summary.adults} adults, ${summary.children} children, ${summary.babies} babies; ${summary.working} working, ${summary.idle} idle, ${summary.military} in squads.`,
    moods ? `How they feel: ${moods}.` : '',
    `Others on the map: ${summary.visitors} visitors, ${summary.merchants} merchants, ${summary.hostiles} hostiles, ${summary.tame_animals} tame animals.`,
    `Jobs: ${summary.jobs_total} queued, ${summary.jobs_suspended} suspended.`,
    summary.stocks.length
      ? `Stocks: ${summary.stocks.map((s) => `${s.key === 'bars' ? 'Bars of every kind' : s.label} ${s.count}`).join(', ')}.`
      : '',
    ...summary.alerts.map((a) => `Alert (${a.severity}): ${a.title}. ${a.detail}`),
  ].filter(Boolean)
}

/** Largest first: "21 iron, 15 billon". */
function byCount(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${fmt(n)} ${name}`)
    .join(', ')
}

function describeStores(s: FortSupplies): string[] {
  const metal = Object.values(s.bars).reduce((a, b) => a + b, 0)
  return compact([
    metal ? `Metal bars (${fmt(metal)}): ${byCount(s.bars)}.` : 'Metal bars: none.',
    `Fuel: ${plural(s.fuelBars, 'bar')} of coke or charcoal${s.coalBoulders ? `, and ${plural(s.coalBoulders, 'boulder')} of coal to make coke from` : ''}.`,
    Object.keys(s.otherBars).length > 0 && `Other bars: ${byCount(s.otherBars)}.`,
    s.ores.length
      ? `Ore waiting to be smelted: ${s.ores.map((o) => `${o.metal} ${plural(o.boulders, 'boulder')} (${o.sources.join(', ')})`).join('; ')}.`
      : 'Ore waiting to be smelted: none.',
    `Flux stone (limestone, dolomite, calcite, chalk, marble): ${plural(s.fluxBoulders, 'boulder')}.`,
    `Nobody holds: ${plural(s.picks, 'pick')}, ${plural(s.axes, 'axe')}, ${plural(s.weapons, 'unclaimed weapon')}, ${plural(s.metalArmor, 'unclaimed piece')} of metal armor.`,
    s.enemyGear.items > 0 &&
      `Enemy gear nobody wears: ${plural(s.enemyGear.items, 'piece')}, ${fmt(s.enemyGear.metal)} of them metal that could be melted down.`,
    `Containers: ${plural(s.emptyBarrels, 'empty barrel')}, ${plural(s.emptyPots, 'empty large pot')}, ${plural(s.bins, 'bin')}, ${plural(s.bags, 'bag')}, ${plural(s.buckets, 'bucket')}, ${plural(s.wheelbarrows, 'wheelbarrow')}.`,
    `Supplies: ${plural(s.cups, 'mug')}, ${plural(s.soap, 'bar')} of soap, ${plural(s.splints, 'splint')}, ${plural(s.crutches, 'crutch', 'crutches')}, ${fmt(s.thread)} thread, ${plural(s.mechanisms, 'loose mechanism')}, ${plural(s.roughGems, 'rough gem')}, ${plural(s.bones, 'bone')}, ${plural(s.shells, 'shell')}, ${fmt(s.tradeGoods)} crafts and other trade goods.`,
    s.artifacts.items > 0 &&
      `Artifacts: ${fmt(s.artifacts.items)}${s.artifacts.loose ? `, ${fmt(s.artifacts.loose)} lying on the floor` : ''}.`,
    s.merchantGoods.items > 0 &&
      `A caravan at the depot offers ${plural(s.merchantGoods.items, 'item')}.`,
  ])
}

const SKILLED_SHOWN = 3

function describeWorkshops(buildings: FortBuilding[], units: FortUnit[]): string[] {
  const rows = workshopBoard(buildings, units)
  const built = rows.filter((r) => r.count > 0)
  const missing = rows.filter((r) => r.count === 0 && r.info.essential)
  return compact([
    built.length
      ? 'Workshops and furnaces built (what they make; jobs; best hands among citizens):'
      : 'Workshops: none built.',
    ...built.map((r) => {
      const hands = r.skilled
        .slice(0, SKILLED_SHOWN)
        .map(({ unit, rating }) => `${firstName(unit)} (${skillRank(rating)})`)
      const parts = compact([
        r.info.makes && `makes ${r.info.makes}`,
        r.jobs ? plural(r.jobs, 'job') : 'no jobs',
        r.info.skills.length > 0 &&
          (hands.length ? hands.join(', ') : `no citizen has ${r.info.skillLabel} skill`),
      ])
      return `- ${r.info.label}${r.count > 1 ? ` x${r.count}` : ''}: ${parts.join('; ')}.`
    }),
    missing.length > 0 &&
      `Essential workshops not built yet: ${missing.map((r) => r.info.label).join(', ')}.`,
  ])
}

function describeJobs(jobs: FortJob[], units: FortUnit[]): string[] {
  const groups = jobQueue(jobs, units).slice(0, JOBS_SHOWN)
  if (!groups.length) return ['Job queue: empty.']
  return [
    `Job queue (largest first): ${groups
      .map((g) => {
        const extra = [
          g.suspended ? `${g.suspended} suspended` : '',
          g.orders ? `${g.orders} from work orders` : '',
        ]
          .filter(Boolean)
          .join(', ')
        return `${g.name} ${g.total}${extra ? ` (${extra})` : ''}`
      })
      .join('; ')}.`,
  ]
}

function describeAdvice(advice: Advice[]): string[] {
  const rank = { problem: 0, attention: 1, good: 2 } as const
  const open = advice
    .filter((a) => a.status !== 'good')
    .sort((a, b) => rank[a.status] - rank[b.status] || b.weight - a.weight)
    .slice(0, ADVICE_SHOWN)
  if (!open.length) return ['The app sees nothing pressing.']
  return [
    'What the app itself flags, most pressing first:',
    ...open.map(
      (a) => `- ${a.status === 'problem' ? 'Problem' : 'Worth a look'}: ${a.title}. ${a.why}`,
    ),
  ]
}

async function fortressEvents(world: FortWorld | null): Promise<FortEvent[]> {
  if (!world || typeof world.year !== 'number' || typeof world.tick !== 'number') return []
  const E = schema.fort_events
  const prefix = `${world.save_dir}:${world.site_id}:`
  return postgres_db
    .select()
    .from(E)
    .where(
      sql`starts_with(${E.dedupe_key}, ${prefix}) and coalesce(${E.type}, '') <> 'CANCEL_JOB' and not coalesce(${E.game_year} > ${world.year} or (${E.game_year} = ${world.year} and ${E.game_tick} > ${world.tick}), false)`,
    )
    .orderBy(desc(E.game_year), desc(E.game_tick), desc(E.id))
    .limit(160)
}

async function fortressBrief(): Promise<FortressBrief> {
  const [stateRows, dumpRows] = await Promise.all([
    postgres_db
      .select({
        status: schema.fort_state.status,
        world: schema.fort_state.world,
        summary: schema.fort_state.summary,
        ageS: sql<number>`extract(epoch from now() - ${schema.fort_state.captured_at})::int`,
      })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1),
    postgres_db
      .select({
        units: schema.fort_dump.units,
        buildings: schema.fort_dump.buildings,
        jobs: schema.fort_dump.jobs,
      })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1),
  ])
  const state = stateRows[0]
  if (!state) return { lines: ['The app has not read a fortress yet.'], status: null }
  const world = state.world
  const summary = state.summary
  const units = decodeTable<FortUnit>(dumpRows[0]?.units)
  const buildings = decodeTable<FortBuilding>(dumpRows[0]?.buildings)
  const jobs = decodeTable<FortJob>(dumpRows[0]?.jobs)
  const [concerns, supplies, events] = await Promise.all([
    getFortConcerns(),
    getFortSupplies(),
    fortressEvents(world),
  ])
  const now = gameTimeOf({ world })
  const age = state.ageS < 90 ? 'moments' : `${Math.round(state.ageS / 60)} minutes`
  const lines = [
    world
      ? `Fortress: ${world.site_name || 'unnamed'}, in the world of ${world.name || 'unknown'}. In the game it is ${formatGameTick(world.year, world.tick)}, ${world.season}. Dwarf Fortress ${world.df_version}, DFHack ${world.dfhack_version}.`
      : '',
    state.status === 'live'
      ? `The app last read the game ${age} ago; everything below is from then.`
      : state.status === 'menu'
        ? `The game is on a menu with no fortress loaded; below is the last fortress the app saw, ${age} ago.`
        : `The game was not reachable at the last try; below is the last fortress the app saw, ${age} ago.`,
    ...(summary ? describeSummary(summary) : []),
    ...describeStores(supplies),
    ...describeWorkshops(buildings, units),
    ...describeJobs(jobs, units),
    ...describeAdvice(
      fortAdvice({ summary, units, buildings, jobs, concerns, supplies, events, now }),
    ),
  ].filter(Boolean)
  return { lines, status: state.status }
}

// ---------------------------------------------------------------------------
// Asking

/** Job types that exist in df.job_type, from DFHack's own order libraries and docs. */
const KNOWN_JOB_TYPES = [
  'BrewDrink',
  'PrepareMeal',
  'MillPlants',
  'ProcessPlants',
  'ProcessPlantsBarrel',
  'MakeCheese',
  'MilkCreature',
  'ShearCreature',
  'SpinThread',
  'WeaveCloth',
  'DyeCloth',
  'MakeBarrel',
  'MakeBucket',
  'MakeFlask',
  'MakeGoblet',
  'MakeBackpack',
  'MakeQuiver',
  'MakeCage',
  'MakeTool',
  'MakeTotem',
  'MakeWindow',
  'MakeRawGlass',
  'MakePipeSection',
  'MakeTrapComponent',
  'MakeCharcoal',
  'MakeAsh',
  'MakeLye',
  'MakePotashFromAsh',
  'SmeltOre',
  'MeltMetalObject',
  'ExtractMetalStrands',
  'MakeWeapon',
  'MakeAmmo',
  'MakeArmor',
  'MakeHelm',
  'MakeGloves',
  'MakePants',
  'MakeShoes',
  'MakeShield',
  'ConstructBed',
  'ConstructTable',
  'ConstructThrone',
  'ConstructDoor',
  'ConstructCabinet',
  'ConstructChest',
  'ConstructCoffin',
  'ConstructBin',
  'ConstructBag',
  'ConstructBlocks',
  'ConstructMechanisms',
  'ConstructArmorStand',
  'ConstructWeaponRack',
  'ConstructStatue',
  'ConstructSlab',
  'ConstructFloodgate',
  'ConstructGrate',
  'ConstructHatchCover',
  'ConstructSplint',
  'ConstructCrutch',
  'CollectSand',
]

const SYSTEM_PROMPT = [
  'You are the advisor in a companion app for Dwarf Fortress (the Steam release, version 50 or later) with DFHack. The player asks how to do things in the game.',
  'Answer briefly: a sentence or two, then numbered steps naming the menus and buttons of the current interface, not the old keyboard shortcuts of the classic version. No preamble, no sign-off.',
  "You are given a summary of the player's fortress as the app last read it. Use it where it helps, and never invent facts about the fortress beyond it; if the summary does not say, say you cannot see that.",
  'When a DFHack command would do the job, give it: every command on its own line inside a fenced code block marked dfhack, with the exact syntax, no prompt characters and no comments inside the block. The player sees each line as a button, reads the command in full and runs it only after confirming. Say in the prose what each command does and whether it changes the game.',
  `Prefer tools you are sure of: workorder <JobType> <amount> queues a manager work order (for example workorder ConstructBed 10); orders import library/basic (also library/furnace, library/smelting, library/glassstock, library/rockstock, library/military) adds standing orders; enable tailor, enable autofarm, enable seedwatch, enable suspendmanager, enable autobutcher; unsuspend; combine all; burial; ban-cooking all. Job types that exist: ${KNOWN_JOB_TYPES.join(', ')}. If you are unsure of a name or a command's options, suggest workorder -l job_type or help <command> first; their output shows in the app.`,
  'Work orders need an appointed manager and a workshop that can do the job; say so when it matters.',
  "There is no weaponsmith's or armorsmith's workshop: the metalsmith's forge (or a magma forge) makes metal weapons, armor, ammo, anvils and tools, worked by dwarves with the weaponsmithing, armorsmithing or metalcrafting skill.",
  'Steel takes two jobs at a smelter: "make pig iron bars" from an iron bar, a flux stone and a bar of coke or charcoal, then "make steel bars" from a pig iron bar, an iron bar, a flux stone and a bar of coke or charcoal, which gives two steel bars. Outside a magma smelter each job also burns a bar of fuel.',
  'Never suggest die or any command that quits the game or deletes files. Call a command a cheat when it does something the game never would on its own.',
  'Formatting: short paragraphs, numbered or bulleted lists, **bold** and `code` only. No headings, no tables.',
].join(' ')

export interface AssistantTurn {
  role: 'player' | 'advisor'
  text: string
}

export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; text: string }
  /** `problem` is set when the app will not run it, say `die`. */
  | { kind: 'command'; command: string; problem: string | null }

export interface AssistantReply {
  /** The reply as the model wrote it; sent back as history with the next question. */
  raw: string
  parts: AssistantPart[]
  model: string
}

const COMMAND_FENCES = new Set(['dfhack', '', 'console', 'sh', 'bash', 'shell'])

/** Prose around fenced blocks; each line of a dfhack block becomes its own command. */
function splitReply(raw: string): AssistantPart[] {
  const parts: AssistantPart[] = []
  const fence = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g
  let last = 0
  const pushText = (text: string) => {
    const trimmed = text.trim()
    if (trimmed) parts.push({ kind: 'text', text: trimmed })
  }
  for (const match of raw.matchAll(fence)) {
    pushText(raw.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    const lang = match[1].toLowerCase()
    const body = match[2]
    if (!COMMAND_FENCES.has(lang)) {
      parts.push({ kind: 'code', lang, text: body.replace(/\s+$/, '') })
      continue
    }
    for (const line of body.split('\n')) {
      const command = line
        .trim()
        .replace(/^(\[DFHack\]#|\$|>)\s*/, '')
        .trim()
      if (!command || command.startsWith('#') || command.startsWith('//')) continue
      parts.push({ kind: 'command', command, problem: checkConsoleCommand(command) })
    }
  }
  pushText(raw.slice(last))
  return parts
}

function cleanTurns(turns: AssistantTurn[] | undefined): AssistantTurn[] {
  if (!Array.isArray(turns)) return []
  return turns
    .filter((t) => (t.role === 'player' || t.role === 'advisor') && typeof t.text === 'string')
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TURN) }))
    .filter((t) => t.text)
}

export const askAssistant = createServerFn({ method: 'POST' })
  .inputValidator((input: { question: string; history?: AssistantTurn[] }) => input)
  .handler(async ({ data }): Promise<AssistantReply> => {
    await requireUser()
    const config = readModelConfig()
    if (!config)
      throw new Error(
        'No model is configured. Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY.',
      )
    const question = (typeof data.question === 'string' ? data.question : '')
      .trim()
      .slice(0, MAX_QUESTION)
    if (!question) throw new Error('Ask something first')
    const history = cleanTurns(data.history)
    const brief = await fortressBrief()
    const user = [
      "The player's fortress:",
      ...brief.lines,
      '',
      ...(history.length
        ? [
            'The conversation so far:',
            ...history.map((t) => `${t.role === 'player' ? 'Player' : 'Advisor'}: ${t.text}`),
            '',
          ]
        : []),
      `Player: ${question}`,
      'Advisor:',
    ].join('\n')
    const raw = (
      await complete(config, {
        system: SYSTEM_PROMPT,
        user,
        temperature: 0.3,
        maxTokens: 900,
        timeoutMs: 90_000,
      })
    )
      .replace(/^Advisor:\s*/, '')
      .trim()
    return { raw, parts: splitReply(raw), model: config.model }
  })

// ---------------------------------------------------------------------------
// Running what it suggests

export interface ConsoleRun {
  id: number
  command: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  output: string | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

/** Queue a console command the player read and confirmed. */
export const queueConsoleCommand = createServerFn({ method: 'POST' })
  .inputValidator((input: { command: string }) => input)
  .handler(async ({ data }): Promise<{ id: number; reused: boolean }> => {
    await requireUser()
    const problem = checkConsoleCommand(data.command)
    if (problem) throw new Error(problem)
    const command = data.command.trim()
    const state = await postgres_db
      .select({ status: schema.fort_state.status })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1)
    if (state[0]?.status !== 'live') throw new Error('A live fortress is required')

    // A second click while the first is still waiting should not run it twice.
    const waiting = await postgres_db
      .select({ id: C.id })
      .from(C)
      .where(
        and(
          eq(C.kind, 'console'),
          eq(C.command, command),
          inArray(C.status, ['pending', 'processing']),
        ),
      )
      .limit(1)
    if (waiting[0]) return { id: waiting[0].id, reused: true }

    const [row] = await postgres_db
      .insert(C)
      .values({ kind: 'console', command })
      .returning({ id: C.id })
    return { id: row.id, reused: false }
  })

export const getConsoleRun = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<ConsoleRun | null> => {
    await requireUser()
    if (!Number.isInteger(data.id)) return null
    const [row] = await postgres_db
      .select()
      .from(C)
      .where(and(eq(C.id, data.id), eq(C.kind, 'console')))
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      command: row.command ?? '',
      status: row.status,
      output: row.output,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  })
