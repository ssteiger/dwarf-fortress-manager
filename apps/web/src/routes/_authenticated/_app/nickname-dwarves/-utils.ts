import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

const GIVEN_NAMES = [
  'Mosus',
  'Tuesday',
  'Goon',
  'Urist',
  'Dingo',
  'Wombo',
  'Bungo',
  'Stabby',
  'Mister',
  'Grumbus',
  'Tuna',
  'Socks',
  'Moldy',
  'Kevin',
  'Plump',
  'Turbo',
  'Biscuit',
  'Crumbus',
  'Doombert',
  'Fungus',
  'Greeble',
  'Honkers',
  'Lunchbox',
  'Nubbins',
  'Oatmeal',
  'Pants',
  'Quackson',
  'Rumble',
  'Spork',
  'Tungsten',
  'Waffles',
  'Zorp',
] as const

const GENERIC_TITLES = [
  'Sackstab',
  'Terminator',
  'Master',
  'Beardcrime',
  'McHammer',
  'Aleproblem',
  'Pickleord',
  'Cave Johnson',
  'Toe Biter',
  'Rock Licker',
  'Goblin Bonker',
  'Barrelmancer',
  'Pantsbane',
  'Cheese Fist',
  'Lunch Destroyer',
  'Health Hazard',
] as const

const ROLE_TITLES: [needles: string[], titles: string[]][] = [
  [
    ['MINER', 'MINING'],
    ['Vein Inspector', 'Tunnel Visionary', 'Granite Dentist', 'Pick Enthusiast', 'Cave Auditor'],
  ],
  [
    ['BREWER', 'BREWING'],
    ['Ale Liability', 'Barrel Prophet', 'Tavern Chemist', 'Booze Wizard', 'Emergency Brewer'],
  ],
  [
    ['COOK', 'COOKING'],
    ['Lunch Destroyer', 'Soup Architect', 'Biscuit Warlord', 'Kitchen Menace', 'Plump Helmet Chef'],
  ],
  [
    ['DOCTOR', 'SURGEON', 'DIAGNOS', 'MEDICAL', 'BONE_SETTING', 'SUTUR'],
    ['Sock Surgeon', 'Bone Negotiator', 'Diagnosis Goblin', 'Health Hazard', 'Emergency Carpenter'],
  ],
  [
    ['SMITH', 'FORGE', 'METAL', 'ARMOR', 'WEAPON'],
    ['Hammer Attorney', 'Forge Goblin', 'Anvil Enthusiast', 'Metal Screamer', 'Steel Whisperer'],
  ],
  [
    ['CARPENTER', 'WOOD', 'BOWYER'],
    ['Chair Engineer', 'Plank Sinatra', 'Saw Supervisor', 'Splinter Wizard', 'Table Prophet'],
  ],
  [
    ['MASON', 'STONE', 'ENGRAV', 'ARCHITECT'],
    ['Rock Licker', 'Wall Enthusiast', 'Granite Poet', 'Brick Whisperer', 'Floor Historian'],
  ],
  [
    ['FARMER', 'PLANT', 'HERBAL', 'GROWER'],
    ['Mud Baron', 'Turnip Marshal', 'Seed Accountant', 'Mushroom Oracle', 'Crop Goblin'],
  ],
  [
    ['FISH', 'HUNTER', 'TRAPPER', 'ANIMAL'],
    ['Carp Nemesis', 'Creature Botherer', 'Net Prophet', 'Wildlife Auditor', 'Fish Criminal'],
  ],
  [
    ['SOLDIER', 'AXE', 'SWORD', 'SPEAR', 'HAMMER', 'CROSSBOW', 'WRESTL'],
    ['Goblin Bonker', 'Violence Clerk', 'Axe Diplomat', 'Siege Enjoyer', 'Helmet Inspector'],
  ],
  [
    ['MECHANIC', 'ENGINEER', 'SIEGE', 'PUMP'],
    ['Lever Enjoyer', 'Trap Academic', 'Gear Goblin', 'Machine Whisperer', 'OSHA Concern'],
  ],
  [
    ['CRAFT', 'CLOTH', 'LEATHER', 'WEAVER', 'CLOTHIER'],
    ['Sock Architect', 'Leather Wizard', 'Craft Gremlin', 'Thread Menace', 'Artisan Goblin'],
  ],
]

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function roleTitles(unit: FortUnit): readonly string[] {
  if (unit.flags.includes('baby')) return ['Tiny Screamer', 'Milk Inspector', 'Sock Oppressor']
  if (unit.flags.includes('child')) return ['Tiny Menace', 'Chore Dodger', 'Future Liability']
  if (unit.positions.length > 0) {
    return [
      'Paperwork Tyrant',
      'Meeting Summoner',
      'Fancy Hat',
      'Mandate Goblin',
      'Important Beard',
    ]
  }

  const strongestSkills = unit.skills
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([skill]) => skill)
  const role = [unit.profession, ...strongestSkills].join(' ').toUpperCase()
  return (
    ROLE_TITLES.find(([needles]) => needles.some((needle) => role.includes(needle)))?.[1] ??
    GENERIC_TITLES
  )
}

function characterModifier(unit: FortUnit): string | null {
  if (unit.wounds > 0) return 'Scarred'
  if (unit.stress_category <= 1) return 'Doomed'
  if (unit.stress_category >= 6) return 'Giddy'
  if (unit.age >= 100) return 'Ancient'
  if (unit.squad) return 'Battle'
  return null
}

export function livingCitizens(units: FortUnit[]): FortUnit[] {
  return units
    .filter(
      (unit) =>
        unit.flags.includes('citizen') &&
        !unit.flags.includes('dead') &&
        !unit.flags.includes('ghost'),
    )
    .sort((a, b) => a.readable.localeCompare(b.readable) || a.id - b.id)
}

/** Stable across polling, but informed by the dwarf's work and current condition. */
export function suggestedNickname(unit: FortUnit): string {
  const strongestSkill = unit.skills.reduce(
    (best, skill) => (skill[1] > (best?.[1] ?? -1) ? skill : best),
    undefined as [string, number] | undefined,
  )?.[0]
  const hash = stableHash(`${unit.id}:${unit.readable}:${unit.profession}:${strongestSkill ?? ''}`)
  const givenName = GIVEN_NAMES[hash % GIVEN_NAMES.length]
  const titles = roleTitles(unit)
  const roleTitle = titles[Math.floor(hash / GIVEN_NAMES.length) % titles.length]
  const modifier = characterModifier(unit)
  return [givenName, modifier, roleTitle].filter(Boolean).join(' ')
}
