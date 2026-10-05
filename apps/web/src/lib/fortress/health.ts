import type {
  CountedSupply,
  FortBuilding,
  FortHealth,
  FortHospital,
  FortPatient,
  HospitalSupply,
} from '@fortress/db-drizzle'

export type MedicalLabor =
  | 'DIAGNOSE'
  | 'SURGERY'
  | 'BONE_SETTING'
  | 'SUTURING'
  | 'DRESSING_WOUNDS'
  | 'RECOVER_WOUNDED'
  | 'FEED_WATER_CIVILIANS'

/** As the Labor screen names them. */
export const MEDICAL_LABOR_LABEL: Record<MedicalLabor, string> = {
  DIAGNOSE: 'Diagnosis',
  SURGERY: 'Surgery',
  BONE_SETTING: 'Bone setting',
  SUTURING: 'Suturing',
  DRESSING_WOUNDS: 'Wound dressing',
  RECOVER_WOUNDED: 'Recovering wounded',
  FEED_WATER_CIVILIANS: 'Feed patients',
}

interface TreatmentSpec {
  /** Follows the patient's name: "Kib needs bones set". */
  needs: string
  /** How the body parts join on: "in the left lower leg". */
  where?: 'in' | 'on'
  labor: MedicalLabor | null
  /** What it takes from the hospital; any one of them will do. */
  uses: HospitalSupply[]
  /** A building it cannot be done without. */
  building?: { type: string; label: string }
}

/** In the order doctors see to them. */
const TREATMENTS = {
  rq_diagnosis: { needs: 'needs a diagnosis', labor: 'DIAGNOSE', uses: [] },
  rq_surgery: { needs: 'needs surgery', where: 'in', labor: 'SURGERY', uses: [] },
  rq_setting: { needs: 'needs bones set', where: 'in', labor: 'BONE_SETTING', uses: [] },
  rq_traction: {
    needs: 'needs traction',
    labor: 'BONE_SETTING',
    uses: [],
    building: { type: 'TractionBench', label: 'traction bench' },
  },
  rq_immobilize: {
    needs: 'needs a splint or cast',
    where: 'on',
    labor: 'BONE_SETTING',
    uses: ['splints', 'powder'],
  },
  rq_suture: { needs: 'needs stitches', where: 'in', labor: 'SUTURING', uses: ['thread'] },
  rq_dressing: {
    needs: 'needs wounds dressed',
    where: 'on',
    labor: 'DRESSING_WOUNDS',
    uses: ['cloth'],
  },
  rq_cleaning: {
    needs: 'needs wounds cleaned',
    where: 'on',
    labor: 'DRESSING_WOUNDS',
    uses: ['soap'],
  },
  rq_crutch: { needs: 'needs a crutch', labor: null, uses: ['crutches'] },
} satisfies Record<string, TreatmentSpec>

export type Treatment = keyof typeof TREATMENTS
const ORDER = Object.keys(TREATMENTS) as Treatment[]
const isTreatment = (token: string): token is Treatment => Object.hasOwn(TREATMENTS, token)
const spec = (t: Treatment): TreatmentSpec => TREATMENTS[t]

export const treatmentLabor = (t: Treatment): MedicalLabor | null => spec(t).labor
export const treatmentUses = (t: Treatment): HospitalSupply[] => spec(t).uses

/** The labors a hospital cannot do without. */
export const CORE_MEDICAL_LABORS: MedicalLabor[] = [
  'DIAGNOSE',
  'BONE_SETTING',
  'SUTURING',
  'DRESSING_WOUNDS',
  'SURGERY',
]

export const SUPPLY_WORD: Record<HospitalSupply, string> = {
  splints: 'splints',
  thread: 'thread',
  cloth: 'cloth',
  crutches: 'crutches',
  powder: 'plaster powder',
  buckets: 'buckets',
  soap: 'soap',
}

/** Where each supply comes from, as a sentence. */
export const SUPPLY_SOURCE: Record<HospitalSupply, string> = {
  splints: 'Make splints at a carpenter’s workshop or a metalsmith’s forge.',
  thread:
    'Spin thread from pig tails or rope reeds at a farmer’s workshop, or collect webs at a loom.',
  cloth: 'Weave cloth from thread at a loom.',
  crutches: 'Make crutches at a carpenter’s workshop or a metalsmith’s forge.',
  powder: 'Make plaster powder at a kiln from gypsum, alabaster, selenite or satinspar.',
  buckets: 'Make buckets at a carpenter’s workshop.',
  soap: 'Make soap at a soap maker’s workshop from lye and tallow.',
}

export interface PatientNeed {
  treatment: Treatment
  /** Body parts it is for, when the game says. */
  parts: string[]
}

/** What a patient waits for, in the order doctors see to it. */
export function patientNeeds(patient: FortPatient): PatientNeed[] {
  const found = new Map<Treatment, string[]>()
  const add = (token: string, part: string | null) => {
    if (!isTreatment(token)) return
    const parts = found.get(token) ?? []
    if (part && !parts.includes(part)) parts.push(part)
    found.set(token, parts)
  }
  for (const token of patient.needs) add(token, null)
  for (const { part, needs } of patient.parts) for (const token of needs) add(token, part)
  return ORDER.filter((t) => found.has(t)).map((t) => ({ treatment: t, parts: found.get(t) ?? [] }))
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "needs bones set in the left lower leg" */
export function needPhrase({ treatment, parts }: PatientNeed): string {
  const { needs, where } = spec(treatment)
  if (!where || !parts.length) return needs
  return `${needs} ${where} the ${joinWords(parts)}`
}

/** All of a patient's needs in one phrase, without body parts: "needs bones set and a splint or cast". */
export function needsSummary(needs: PatientNeed[]): string {
  return `needs ${joinWords(needs.map((n) => spec(n.treatment).needs.replace(/^needs /, '')))}`
}

export interface HealthContext {
  health: FortHealth
  /** Null when not at hand: then nothing is said about buildings. */
  buildings: FortBuilding[] | null
}

/** What stands between a patient and a treatment, each as a clause: "nobody has Bone setting on". */
export function needBlockers(need: PatientNeed, { health, buildings }: HealthContext): string[] {
  const { labor, building, uses } = spec(need.treatment)
  const out: string[] = []
  if (!health.hospitals.length) out.push('there is no hospital')
  if (labor && !health.doctors.some((d) => d.labors.includes(labor)))
    out.push(`nobody has ${MEDICAL_LABOR_LABEL[labor]} on`)
  if (building && buildings && !buildings.some((b) => b.type === building.type))
    out.push(`there is no ${building.label}`)
  const missing = hospitalLacks(health.hospitals, uses)
  const none = missing.filter(isCounted).map((s) => SUPPLY_WORD[s])
  const low = missing.filter((s) => !isCounted(s)).map((s) => SUPPLY_WORD[s])
  if (none.length && low.length)
    out.push(`the hospital has no ${joinWords(none)} and is short of ${joinWords(low)}`)
  else if (none.length) out.push(`the hospital has no ${joinWords(none)}`)
  else if (low.length) out.push(`the hospital is short of ${joinWords(low)}`)
  return out
}

const isCounted = (s: HospitalSupply): s is CountedSupply =>
  s === 'splints' || s === 'crutches' || s === 'buckets'

/**
 * The supplies, of those asked for, that no hospital can offer: none when one
 * of them is there, or when the dump does not say what the hospitals keep.
 */
export function hospitalLacks(hospitals: FortHospital[], uses: HospitalSupply[]): HospitalSupply[] {
  if (!uses.length || !hospitals.some((h) => h.short)) return []
  const has = (h: FortHospital, s: HospitalSupply) => {
    const n = isCounted(s) ? h.have?.[s] : undefined
    return n !== undefined ? n > 0 : !h.short?.includes(s)
  }
  return uses.some((s) => hospitals.some((h) => has(h, s))) ? [] : uses
}

/** How many of a supply the hospital is set to keep, for those it counts in items. */
export function hospitalLimit(h: FortHospital, s: HospitalSupply): number | undefined {
  return isCounted(s) ? h.max?.[s] : undefined
}

/** What hospitals say they need more of, every supply once. */
export function hospitalShortages(hospitals: FortHospital[]): HospitalSupply[] {
  const out = new Set<HospitalSupply>()
  for (const h of hospitals) for (const s of h.short ?? []) out.add(s)
  return [...out]
}
