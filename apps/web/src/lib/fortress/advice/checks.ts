import type { FortUnit, HospitalSupply } from '@fortress/db-drizzle'

import { isLiving, splitPascal, stressLabel, unitGroup } from '../format'
import { fortFeelings } from '../people/thoughts'
import {
  firstName,
  isCitizenish,
  isGrownCitizen,
  isOwnGhost,
  pronouns,
  remainsOf,
} from '../people/units'
import {
  CORE_MEDICAL_LABORS,
  MEDICAL_LABOR_LABEL,
  SUPPLY_SOURCE,
  SUPPLY_WORD,
  hospitalLacks,
  hospitalLimit,
  hospitalShortages,
  needBlockers,
  needPhrase,
  needsSummary,
  patientNeeds,
  treatmentLabor,
  treatmentUses,
} from './health'
import { cancellationHint, creatureCounts } from './notices'
import { compact, fmt, list, names, plural } from './phrasing'
import type { Advice, AdviceStatus, AdvisorInput } from './types'
import { DIG_JOBS, SHOP_TYPES, skilledIn } from './workshops'

/*
 * Client-safe: what a thriving fortress needs, checked against the dump,
 * with what to do in the game when a check fails. Everything here reads
 * data the pages already fetch; nothing is sent to the game.
 */

const FOOD_KEYS = ['meals', 'meat', 'fish', 'plants', 'cheese', 'eggs']

const POSITIONS: { re: RegExp; label: string; why: string }[] = [
  { re: /manager/i, label: 'manager', why: 'handles work orders' },
  {
    re: /bookkeeper/i,
    label: 'bookkeeper',
    why: 'keeps the stock counts that order conditions rely on',
  },
  { re: /broker/i, label: 'broker', why: 'trades with caravans at the depot' },
  {
    re: /medical/i,
    label: 'chief medical dwarf',
    why: 'runs the hospital and diagnoses the hurt',
  },
  {
    re: /militia commander|captain|general/i,
    label: 'militia commander',
    why: 'leads the first squad',
  },
]

export function fortAdvice(input: AdvisorInput): Advice[] {
  const { summary, units, buildings, jobs, concerns, supplies, now } = input
  const out: Advice[] = []
  const add = (advice: Advice) => out.push(advice)

  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const adults = citizens.filter(isGrownCitizen)
  const pop = citizens.length
  if (!summary || pop === 0) return out

  const stock = (key: string) => summary.stocks.find((s) => s.key === key)?.count ?? 0
  const zones: Record<string, number> = {}
  const built: Record<string, number> = {}
  const shops: Record<string, number> = {}
  for (const b of buildings) {
    if (b.type === 'Civzone' && b.subtype) zones[b.subtype] = (zones[b.subtype] ?? 0) + 1
    else if (SHOP_TYPES.has(b.type) && b.subtype) shops[b.subtype] = (shops[b.subtype] ?? 0) + 1
    else {
      const key = b.type === 'Trap' && b.subtype ? b.subtype : b.type
      built[key] = (built[key] ?? 0) + 1
    }
  }
  const skilled = (skills: string[]) => skilledIn(citizens, skills).map((s) => s.unit)
  const holder = (re: RegExp) => citizens.find((u) => u.positions.some((p) => re.test(p)))
  const feelings = fortFeelings(units, now)
  const feltBy = (thought: string) =>
    feelings.filter((f) => f.thought === thought && f.tone === 'bad').flatMap((f) => f.units)
  const idle = adults.filter((u) => !u.job && !u.squad && !u.mood)
  const failing = summary.alerts.filter((a) => a.kind === 'cancellation')

  // Food and drink ----------------------------------------------------------
  {
    const drink = stock('drink')
    const each = drink / pop
    const stills = shops.Still ?? 0
    const brewers = skilled(['BREWING'])
    const plants = stock('plants') + stock('plant_growths')
    const status: AdviceStatus = each < 5 ? 'problem' : each < 15 ? 'attention' : 'good'
    add({
      key: 'drink',
      area: 'food',
      status,
      weight: 100,
      title: status === 'good' ? 'Drink is flowing' : 'Brew more drink',
      why: `${plural(drink, 'drink')} for ${plural(pop, 'dwarf', 'dwarves')}: ${Math.floor(each)} each. Dwarves without drink slow down and sulk; with none at all they die of thirst within weeks.`,
      steps: compact([
        stills
          ? `You have ${plural(stills, 'still')}. ${brewers.length ? `${names(brewers)} ${brewers.length === 1 ? 'knows' : 'know'} brewing.` : 'Nobody has brewed before: give someone the Brewing labor.'}`
          : 'Build a still (Build → Workshops → Still) and give someone the Brewing labor.',
        `Add a repeating "Brew drink from plant" work order that only runs while drink is under ${fmt(pop * 20)} (Work orders → set a condition).`,
        `Brewing takes a plant and an empty barrel or large pot: you have ${plural(plants, 'plant')}${supplies ? ` and ${plural(supplies.emptyBarrels, 'empty barrel')}` : ''}.`,
      ]),
      actions: ['basicOrders'],
    })
  }
  {
    const food = FOOD_KEYS.reduce((sum, key) => sum + stock(key), 0)
    const each = food / pop
    const plots = built.FarmPlot ?? 0
    const farmers = skilled(['PLANT'])
    const cooks = skilled(['COOK'])
    const kitchens = shops.Kitchen ?? 0
    const status: AdviceStatus = each < 3 ? 'problem' : each < 10 ? 'attention' : 'good'
    add({
      key: 'food',
      area: 'food',
      status,
      weight: 90,
      title: status === 'good' ? 'Enough to eat' : 'Grow and cook more food',
      why: `${plural(food, 'portion')} of food for ${plural(pop, 'dwarf', 'dwarves')}: ${Math.floor(each)} each, ${plural(stock('meals'), 'prepared meal')} among them.`,
      steps: compact([
        plots
          ? `Keep all ${plural(plots, 'farm plot')} planted every season: ${plural(stock('seeds'), 'seed')} in store, ${farmers.length ? `and ${names(farmers)} can farm` : 'but nobody has farmed before'}. Plump helmets grow underground all year.`
          : 'Build a farm plot on soil or on muddied stone underground, and plant plump helmets.',
        kitchens
          ? cooks.length
            ? `${names(cooks)} can cook: meals keep for years and dwarves like variety.`
            : 'Nobody knows how to cook: give someone the Cooking labor, then add a "Prepare easy meal" order with a condition.'
          : 'Build a kitchen to turn plants and meat into meals that keep.',
        'Fish, hunt, gather wild plants (Zones → Gather fruit), and butcher animals you will not keep.',
      ]),
      actions: [
        'autofarm',
        'seedwatch',
        'seedwatchAll',
        'banCooking',
        ...(stock('eggs') > 0 ? (['nestboxes'] as const) : []),
      ],
      dfhack: [
        {
          command: 'enable autobutcher',
          what: 'culls surplus animals and keeps breeding pairs; set its targets first',
        },
      ],
    })
  }

  // Health and the dead ------------------------------------------------------
  {
    const hurt = citizens.filter((u) => u.wounds > 0)
    const hospitals = zones.Hospital ?? 0
    const doctor = holder(/medical/i)
    const diagnosers = skilled(['DIAGNOSE'])
    const health = concerns?.health ?? null
    const shortages = health ? hospitalShortages(health.hospitals) : []
    const inStore: Record<HospitalSupply, number | null> = {
      splints: supplies?.splints ?? null,
      crutches: supplies?.crutches ?? null,
      buckets: supplies?.buckets ?? null,
      soap: supplies?.soap ?? null,
      thread: supplies?.thread ?? null,
      cloth: stock('cloth'),
      powder: null,
    }
    const supplyHelp = (s: HospitalSupply): string => {
      const n = inStore[s]
      if (health?.hospitals.some((h) => hospitalLimit(h, s) === 0))
        return `The hospital is set to keep no ${SUPPLY_WORD[s]}: raise the number in the zone’s settings.`
      return n
        ? `The fortress holds ${fmt(n)} ${SUPPLY_WORD[s]}; dwarves carry them to the hospital when it has room and a path leads there.`
        : SUPPLY_SOURCE[s]
    }
    const status: AdviceStatus = hospitals
      ? shortages.length
        ? 'attention'
        : 'good'
      : hurt.length
        ? 'problem'
        : 'attention'
    add({
      key: 'hospital',
      area: 'health',
      status,
      weight: 95,
      title: hospitals
        ? shortages.length
          ? 'Stock the hospital'
          : 'A hospital is ready'
        : 'Build a hospital',
      why: hospitals
        ? `${plural(hospitals, 'hospital zone')}${hurt.length ? `, with ${plural(hurt.length, 'dwarf', 'dwarves')} hurt` : ''}.${shortages.length ? ` The game says it needs more ${list(shortages.map((s) => SUPPLY_WORD[s]))}.` : ''}`
        : hurt.length
          ? `${plural(hurt.length, 'dwarf is', 'dwarves are')} hurt and there is nowhere to treat them. Untreated wounds fester and heal slowly, if at all.`
          : 'Nobody is hurt yet, but when someone is, there is nowhere to treat them.',
      steps: compact([
        !hospitals && 'Zones → Hospital, over a quiet room with a few beds and a table.',
        ...(shortages.length
          ? shortages.map(supplyHelp)
          : [
              supplies
                ? `Give it water: a well nearby, or buckets (you have ${supplies.buckets}).`
                : 'Give it water: a well nearby, or buckets.',
              supplies
                ? `Keep supplies close: thread and cloth for sutures and dressings (${plural(stock('cloth'), 'cloth', 'cloth')}), splints (${supplies.splints}), crutches (${supplies.crutches}), soap (${supplies.soap}).`
                : 'Keep thread, cloth, splints, crutches and soap close.',
            ]),
        doctor
          ? `${firstName(doctor)} is your chief medical dwarf${diagnosers.includes(doctor) ? '.' : `, but has never diagnosed anyone: enable Diagnosis for ${pronouns(doctor).them} in the Labor screen.`}`
          : 'Appoint a chief medical dwarf in the Nobles screen, and enable the medical labors on your doctors.',
      ]),
      actions: hospitals ? ['dwarfvet'] : undefined,
      units: hurt,
    })

    const byId = new Map(citizens.map((u) => [u.id, u]))
    const patients = (health?.patients ?? []).flatMap((p) => {
      const unit = byId.get(p.unit)
      const needs = patientNeeds(p)
      return unit && needs.length ? [{ unit, needs }] : []
    })
    if (health && patients.length) {
      const context = { health, buildings }
      const waits = patients.map(({ unit, needs }) => ({
        unit,
        needs,
        stuck: needs.flatMap((need) => {
          const blockers = needBlockers(need, context)
          return blockers.length ? [{ need, blockers }] : []
        }),
      }))
      const stuck = waits.filter((w) => w.stuck.length)
      const missingSupplies = new Set<HospitalSupply>()
      const missingLabors = new Set<string>()
      for (const w of stuck)
        for (const { need } of w.stuck) {
          for (const s of hospitalLacks(health.hospitals, treatmentUses(need.treatment)))
            missingSupplies.add(s)
          const labor = treatmentLabor(need.treatment)
          if (labor && !health.doctors.some((d) => d.labors.includes(labor)))
            missingLabors.add(MEDICAL_LABOR_LABEL[labor])
        }
      const lead = [...stuck, ...waits.filter((w) => !w.stuck.length)]
      const told = lead
        .slice(0, 3)
        .map(({ unit, needs }) => `${firstName(unit)} ${needsSummary(needs)}.`)
      add({
        key: 'patients',
        area: 'health',
        status: stuck.length ? 'problem' : 'good',
        weight: 98,
        title: stuck.length
          ? stuck.length === 1
            ? `Get ${firstName(stuck[0].unit)} treated`
            : 'Get the hurt treated'
          : `The doctors are seeing to ${plural(patients.length, 'dwarf', 'dwarves')}`,
        why: `${told.join(' ')}${lead.length > 3 ? ` ${plural(lead.length - 3, 'other waits', 'others wait')} too.` : ''}`,
        steps: compact([
          ...stuck
            .flatMap((w) =>
              w.stuck.map(
                ({ need, blockers }) =>
                  `${firstName(w.unit)} ${needPhrase(need)}; ${list(blockers)}.`,
              ),
            )
            .slice(0, 6),
          !health.hospitals.length &&
            'Zones → Hospital, over a quiet room with a few beds and a table.',
          missingLabors.size &&
            `Enable ${list([...missingLabors])} for a dwarf or two in the Labor screen.`,
          ...[...missingSupplies].map(supplyHelp),
          stuck.some((w) => w.stuck.some((s) => s.need.treatment === 'rq_traction')) &&
            !buildings.some((b) => b.type === 'TractionBench') &&
            'Build a traction bench in the hospital, from a table, a mechanism and a rope or chain.',
          !stuck.length &&
            'Everything they need is there. Keep the hospital quiet and stocked until they are back on their feet.',
        ]),
        units: lead.map((w) => w.unit),
      })
    }

    const medics = skilled(['DIAGNOSE', 'SURGERY', 'SUTURE', 'SET_BONE'])
    const onDuty = health ? new Set(health.doctors.flatMap((d) => d.labors)) : null
    const offDuty = onDuty
      ? CORE_MEDICAL_LABORS.filter((l) => !onDuty.has(l)).map((l) => MEDICAL_LABOR_LABEL[l])
      : []
    if (!medics.length || offDuty.length)
      add({
        key: 'doctors',
        area: 'health',
        status: 'attention',
        weight: 60,
        title: offDuty.length ? 'Put some dwarves on medical duty' : 'Train some doctors',
        why: offDuty.length
          ? `Nobody has ${list(offDuty)} on, so the hurt wait in bed for treatment that never comes.`
          : 'Nobody has diagnosed, sutured, set a bone or operated. Medical skill only grows by treating patients, so start before the first siege.',
        steps: compact([
          'Pick two or three steady dwarves and enable Diagnosis, Suturing, Bone setting, Surgery and Wound dressing in the Labor screen.',
          medics.length > 0 && `${names(medics)} have done it before.`,
          doctor && `${firstName(doctor)} should be the one who diagnoses.`,
          'Everyone else can keep Feed patients and Recovering wounded, so the hurt get carried to bed.',
        ]),
        units: medics,
      })
  }
  {
    const unburied = concerns?.unburied ?? []
    const ghosts = units.filter(isOwnGhost)
    const tombs = zones.Tomb ?? 0
    const coffins = built.Coffin ?? 0
    const byId = new Map(units.map((u) => [u.id, u]))
    const whose = (b: (typeof unburied)[number]) => {
      const unit = byId.get(b.unitId)
      return unit ? firstName(unit) : b.name
    }
    const body = (b: (typeof unburied)[number]) =>
      `${remainsOf(b, byId.get(b.unitId))}${b.x !== null ? ` (at ${b.x},${b.y} z${b.z})` : ''}`
    const status: AdviceStatus =
      unburied.length || ghosts.length ? 'problem' : tombs && coffins ? 'good' : 'attention'
    const ghostWhy = ghosts.length
      ? `${ghosts.length === 1 ? `The ghost of ${firstName(ghosts[0])} walks` : `${ghosts.length} ghosts walk`} the fortress, frightening the living.`
      : null
    add({
      key: 'burial',
      area: 'health',
      status,
      weight: ghosts.length ? 110 : 80,
      title: ghosts.length
        ? ghosts.length === 1
          ? `Put ${firstName(ghosts[0])}’s ghost to rest`
          : `Put ${ghosts.length} ghosts to rest`
        : unburied.length
          ? unburied.length === 1
            ? `Bury ${whose(unburied[0])}`
            : `Bury your ${unburied.length} dead`
          : tombs && coffins
            ? 'Room for the dead'
            : 'Prepare a place for the dead',
      why: compact([
        ghostWhy,
        unburied.length
          ? `${list(unburied.map(body))} ${unburied.length === 1 ? 'lies' : 'lie'} unburied. Seeing the dead shakes the living, and the unburied can return as ghosts.`
          : null,
        !ghostWhy && !unburied.length
          ? `${plural(tombs, 'tomb zone')} and ${plural(coffins, 'coffin')} placed.`
          : null,
      ]).join(' '),
      steps: compact([
        'Place a coffin (Build → Furniture → Coffin) and draw a tomb zone over it. In the zone settings, allow burial.',
        'Dwarves carry the dead to a free coffin on their own.',
        "For bodies that are lost or destroyed, make a slab at a mason's workshop, engrave it as a memorial at a craftsdwarf's workshop, and place it.",
        ghosts.length
          ? 'A ghost rests once its body is in a coffin or its memorial slab is placed. DFHack’s autoslab orders the slabs for every ghost.'
          : null,
      ]),
      actions: ghosts.length ? ['burial', 'autoslab'] : ['burial'],
      units: [
        ...ghosts,
        ...unburied.map((b) => byId.get(b.unitId)).filter((u): u is FortUnit => u !== undefined),
      ],
    })
  }

  // Safety -------------------------------------------------------------------
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const inSight = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  {
    const soldiers = citizens.filter((u) => u.squad)
    const squads = new Set(soldiers.map((u) => u.squad)).size
    const commander = holder(/militia commander|captain|general/i)
    const weapons = supplies?.weapons ?? 0
    const armor = supplies?.metalArmor ?? 0
    const status: AdviceStatus = squads ? 'good' : inSight.length ? 'problem' : 'attention'
    add({
      key: 'military',
      area: 'safety',
      status,
      weight: inSight.length ? 120 : 70,
      title: squads
        ? `${plural(soldiers.length, 'dwarf stands', 'dwarves stand')} ready`
        : 'Raise a squad',
      why: squads
        ? `${plural(squads, 'squad')} with ${plural(soldiers.length, 'soldier')}.`
        : `No one is in a squad${weapons || armor ? `, while ${list(compact([weapons && plural(weapons, 'weapon'), armor && `${plural(armor, 'piece', 'pieces')} of metal armor`]))} sit in storage` : ''}. Wealth draws thieves and sieges sooner or later.`,
      steps: compact([
        commander
          ? `${firstName(commander)} is your militia commander.`
          : 'Appoint a militia commander in the Nobles screen: they lead the first squad.',
        'Squads → Create squad, and add dwarves who are not your only miner, doctor or brewer.',
        `Equip them with metal armor, a helm, a shield and one weapon each${weapons ? ': your stores have weapons to spare' : ''}.`,
        `Schedule training in a barracks when there is no threat${zones.Barracks ? ` (you have ${plural(zones.Barracks, 'barracks', 'barracks')})` : ' (Zones → Barracks)'}, and station them at the gate when danger comes.`,
      ]),
      units: soldiers,
    })
  }
  {
    const bridges = built.Bridge ?? 0
    const levers = built.Lever ?? 0
    const cageTraps = built.CageTrap ?? 0
    const weaponTraps = built.WeaponTrap ?? 0
    const status: AdviceStatus = bridges && levers ? 'good' : 'attention'
    add({
      key: 'gates',
      area: 'safety',
      status,
      weight: 50,
      title: status === 'good' ? 'The gates can be shut' : 'Make a way to shut the gates',
      why: `${plural(bridges, 'bridge')}, ${plural(levers, 'lever')}, ${plural(cageTraps, 'cage trap')} and ${plural(weaponTraps, 'weapon trap')}.`,
      steps: [
        'Put a drawbridge at the main entrance and link it to a lever inside, so one pull seals the fortress.',
        'Line the entrance corridor with cage traps and weapon traps. Cage traps need a supply of empty cages.',
        'Keep one main way in: fewer entrances are easier to hold.',
      ],
    })
  }
  if (inSight.length)
    add({
      key: 'threat',
      area: 'safety',
      status: 'problem',
      weight: 150,
      title: `Deal with ${creatureCounts(inSight)}`,
      why: 'Hostile creatures are in sight on the map.',
      steps: [
        'Pull the lever that raises the drawbridge, or lock the outer doors.',
        'Send civilians indoors: set up a burrow for them and raise the civilian alert in the Squads screen.',
        'Station your squads at a choke point, behind traps if you have them.',
        'Afterwards, haul the dead to a refuse pile and bury your own.',
      ],
      units: inSight,
      link: { to: '/fortress/map', label: 'Open the map' },
    })
  if (unseen.length)
    add({
      key: 'caverns',
      area: 'safety',
      status: 'attention',
      weight: 65,
      title: 'Keep the caverns sealed',
      why: `${creatureCounts(unseen)} ${unseen.length === 1 ? 'lurks' : 'lurk'} unseen deep below.`,
      steps: [
        'Wall off, or cover with hatches, every tunnel that leads into the caverns.',
        'Do not send woodcutters, fishers or gatherers into the caverns alone.',
        'When you are ready, lure what lives there into cage traps, or meet it with a full squad in metal armor.',
      ],
    })

  // Industry -----------------------------------------------------------------
  {
    const workshops = buildings.filter((b) => SHOP_TYPES.has(b.type))
    const busy = workshops.filter((b) => b.jobs.length > 0).length
    const orders = new Set(jobs.filter((j) => j.order_id >= 0).map((j) => j.order_id)).size
    const manager = holder(/manager/i)
    const cups = supplies?.cups ?? null
    const makeNow = compact([
      cups !== null && cups < pop && `${pop - cups} mugs`,
      stock('cloth') < 10 && 'cloth',
      supplies && supplies.fuelBars < 10 && 'charcoal or coke',
      (supplies ? Object.values(supplies.bars).reduce((a, b) => a + b, 0) : stock('bars')) < 10 &&
        'metal bars',
      supplies && supplies.emptyBarrels < 5 && 'barrels',
      supplies && supplies.bins < 5 && 'bins',
      stock('meals') < pop * 2 && 'meals',
      (built.Bed ?? 0) < pop && 'beds',
    ])
    const status: AdviceStatus = workshops.length && busy === 0 ? 'attention' : 'good'
    add({
      key: 'workshops',
      area: 'industry',
      status,
      weight: idle.length ? 85 : 55,
      title:
        status === 'good'
          ? `${busy} of ${workshops.length} workshops at work`
          : 'Put your workshops to work',
      why:
        status === 'good'
          ? `${plural(orders, 'work order')} running.`
          : `None of your ${plural(workshops.length, 'workshop')} has a job queued${idle.length ? `, while ${plural(idle.length, 'dwarf has', 'dwarves have')} nothing to do` : ''}.`,
      steps: compact([
        'Open the Work orders screen and add orders for what you are short of.',
        makeNow.length && `Worth making now: ${list(makeNow)}.`,
        'Give each order a condition ("only while fewer than 20 in stock") so it repeats on its own without flooding the stores.',
        manager
          ? `${firstName(manager)} is your manager and approves new orders.`
          : 'Appoint a manager in the Nobles screen to handle work orders.',
      ]),
      actions: ['basicOrders', 'sortOrders'],
    })
  }
  if (supplies) {
    const ironBars = Object.entries(supplies.bars)
      .filter(([material]) => /iron|steel/.test(material))
      .reduce((sum, [, n]) => sum + n, 0)
    const iron = supplies.ores.find((o) => o.metal === 'iron')
    const copper = supplies.ores.find((o) => o.metal === 'copper')
    const tin = supplies.ores.find((o) => o.metal === 'tin')
    const wantsBars = failing.find((a) => /bars/i.test(a.detail))
    const smelters = (shops.Smelter ?? 0) + (shops.MagmaSmelter ?? 0)
    const forges = (shops.MetalsmithsForge ?? 0) + (shops.MagmaForge ?? 0)
    const smelterHands = skilled(['SMELT'])
    const status: AdviceStatus = ironBars >= 10 ? 'good' : wantsBars ? 'problem' : 'attention'
    add({
      key: 'metal',
      area: 'industry',
      status,
      weight: wantsBars ? 75 : 45,
      title: ironBars >= 10 ? 'Iron on hand' : iron ? 'Smelt your iron ore' : 'Find or buy iron',
      why: compact([
        `${plural(ironBars, 'iron bar')} in store`,
        iron &&
          `, and ${plural(iron.boulders, 'boulder')} of ${list(iron.sources)} wait to be smelted`,
        '.',
        wantsBars &&
          ` "${wantsBars.title.replace(/ keeps failing$/, '')}" keeps failing for want of bars.`,
      ]).join(''),
      steps: compact([
        supplies.fuelBars
          ? `${plural(supplies.fuelBars, 'bar')} of fuel ready.`
          : `Make fuel first: "Make charcoal" at a wood furnace from logs (${fmt(stock('logs'))} in store)${supplies.coalBoulders ? `, or "Make coke" at a smelter from your ${plural(supplies.coalBoulders, 'coal boulder')}` : ''}.`,
        iron
          ? `Then "Smelt ore" at a smelter (${smelters ? `you have ${smelters}` : 'build one'}): each boulder of ore takes one bar of fuel.`
          : 'Watch for hematite, magnetite or limonite while mining, or buy iron bars from a caravan.',
        supplies.enemyGear.metal > 0 &&
          `Loot melts down too: ${plural(supplies.enemyGear.metal, 'piece')} of enemy metal gear lie around. Mark them for melting and a smelter turns them into bars.`,
        smelterHands.length
          ? `${names(smelterHands)} can smelt.`
          : 'Nobody has smelted before: give someone the Furnace operating labor.',
        forges
          ? "Then the metalsmith's forge can make anvils, picks, weapons and armor."
          : "Build a metalsmith's forge to work the bars.",
        copper &&
          tin &&
          `You also have copper ore (${list(copper.sources)}) and tin ore (${list(tin.sources)}): together they alloy into bronze.`,
      ]),
      actions: supplies.ores.length ? ['furnaceOrders', 'smeltingOrders'] : undefined,
      link: supplies.enemyGear.metal
        ? { to: '/fortress/items', label: 'Show the loot', view: 'enemy' }
        : undefined,
    })

    const cloth = stock('cloth')
    const weavers = skilled(['WEAVING'])
    add({
      key: 'cloth',
      area: 'industry',
      status: cloth >= 10 ? 'good' : 'attention',
      weight: 40,
      title: cloth >= 10 ? 'Cloth in store' : 'Weave cloth',
      why: `${plural(cloth, 'cloth', 'cloth')} in store${supplies.webs ? `, and ${plural(supplies.webs, 'spider web')} in the caverns that nobody has collected` : ''}. Cloth goes into bandages, clothes, bags and rope.`,
      steps: compact([
        supplies.webs
          ? '"Collect webs" at a loom gathers cave spider silk. Keep the collectors away from whatever spun it.'
          : "Spin thread from pig tails or rope reeds at a farmer's workshop, or shear and spin wool.",
        shops.Loom ? '"Weave cloth" at the loom turns thread into cloth.' : 'Build a loom.',
        weavers.length
          ? `${names(weavers)} can weave.`
          : 'Nobody has woven before: give someone the Weaving labor.',
      ]),
    })

    if (supplies.wornClothes)
      add({
        key: 'clothes',
        area: 'comfort',
        status: 'attention',
        weight: 30,
        title: 'Replace worn clothing',
        why: `${plural(supplies.wornClothes, 'piece')} of clothing your dwarves wear ${supplies.wornClothes === 1 ? 'is' : 'are'} threadbare or tattered. Rags make dwarves unhappy.`,
        steps: [
          "At a clothier's shop, make shirts, trousers, socks and shoes from cloth or leather.",
          'Dwarves change into new clothes on their own once there are some in stock.',
        ],
        actions: ['tailor', 'cleanowned'],
        link: { to: '/fortress/items', label: 'Show worn items', view: 'worn' },
      })

    const forbidden = Object.entries(supplies.forbidden).sort((a, b) => b[1] - a[1])
    const forbiddenTotal = forbidden.reduce((sum, [, n]) => sum + n, 0)
    if (forbiddenTotal >= 20)
      add({
        key: 'forbidden',
        area: 'industry',
        status: 'attention',
        weight: 25,
        title: 'Claim forbidden items',
        why: `${plural(forbiddenTotal, 'item is', 'items are')} forbidden, mostly ${list(forbidden.slice(0, 3).map(([type, n]) => `${fmt(n)} ${splitPascal(type).toLowerCase()}`))}. Usually the gear of the fallen.`,
        steps: [
          'Your dwarves ignore forbidden items. Unforbid what you want to use or melt from the map or the item list.',
          'Metal gear from enemies melts down into bars at a smelter.',
        ],
        dfhack: [
          {
            command: 'unforbid all',
            what: 'unforbids everything, including what you forbade on purpose, so use with care',
          },
        ],
        link: { to: '/fortress/items', label: 'Show the forbidden items', view: 'forbidden' },
      })

    if (supplies.looseRefuse >= 30) {
      const miasma = feltBy('Miasma')
      add({
        key: 'refuse',
        area: 'comfort',
        status: 'attention',
        weight: miasma.length ? 55 : 20,
        title: 'Clear away the refuse',
        why: `${plural(supplies.looseRefuse, 'corpse, remain or body part', 'corpses, remains and body parts')} lie outside any stockpile${miasma.length ? `, and ${plural(miasma.length, 'dwarf', 'dwarves')} choked on miasma this month` : ''}.`,
        steps: [
          'Stockpiles → Refuse, outside or behind a door, away from where dwarves eat and sleep.',
          'Rotting remains indoors fill the halls with miasma, which dwarves hate.',
          'Forbidden vermin remains stay put until you unforbid them.',
        ],
        units: miasma,
        link: { to: '/fortress/items', label: 'Show the refuse', view: 'refuse' },
      })
    }

    const cups = supplies.cups
    const noCup = feltBy('DrinkWithoutCup')
    add({
      key: 'cups',
      area: 'comfort',
      status: cups >= pop ? 'good' : 'attention',
      weight: noCup.length ? 50 : 20,
      title: cups >= pop ? 'Cups for everyone' : 'Make mugs',
      why: `${plural(cups, 'cup')} for ${plural(pop, 'dwarf', 'dwarves')}.${noCup.length ? ` ${plural(noCup.length, 'dwarf', 'dwarves')} grumbled about drinking without one this month.` : ''}`,
      steps: [
        `At a craftsdwarf's workshop, "Make rock mug" (or wooden cups from logs), about one per dwarf${pop > cups ? `: ${fmt(pop - cups)} more` : ''}.`,
        'Store them in a stockpile near the drink.',
      ],
      units: noCup,
    })
  }

  const suspended = jobs.filter((j) => j.suspended)
  if (suspended.length) {
    const kinds = new Map<string, number>()
    for (const job of suspended) {
      const name = job.name || splitPascal(job.type)
      kinds.set(name, (kinds.get(name) ?? 0) + 1)
    }
    add({
      key: 'suspended',
      area: 'industry',
      status: 'attention',
      weight: 35,
      title: `Unsuspend ${plural(suspended.length, 'job')}`,
      why: `${list([...kinds.entries()].map(([name, n]) => `${fmt(n)} × ${name.toLowerCase()}`))} ${suspended.length === 1 ? 'is' : 'are'} suspended.`,
      steps: [
        'A construction suspends when its site is blocked by an item, a creature or water, or its materials cannot be reached.',
        "Clear the site, then resume the job from the building's menu.",
      ],
      actions: ['unsuspend', 'suspendmanager'],
    })
  }

  if (failing.length)
    add({
      key: 'failing',
      area: 'industry',
      status: 'problem',
      weight: 70,
      title: 'Fix the jobs that keep failing',
      why: `${plural(failing.length, 'job keeps', 'jobs keep')} getting cancelled, over and over.`,
      steps: [
        ...failing.map((a) => {
          const hint = cancellationHint(a.detail)
          return `${a.title.replace(/ keeps failing$/, '')}: ${a.detail.toLowerCase()} (×${a.count}).${hint ? ` ${hint}` : ''}`
        }),
        'If the materials are gone for now, have the manager re-check the orders so they wait instead of failing.',
      ],
      actions: ['recheckOrders'],
      link: { to: '/fortress/chronicle', label: 'See the cancellations' },
    })

  // Labor --------------------------------------------------------------------
  if (idle.length)
    add({
      key: 'idle',
      area: 'labor',
      status: 'attention',
      weight: 60,
      title: 'Find work for idle hands',
      why: `${names(idle)} ${idle.length === 1 ? 'has' : 'have'} nothing to do.`,
      steps: [
        'Queue work orders so the workshops have something to make.',
        'Give idle dwarves more labors in the Labor screen: hauling, cleaning, and whatever your workshops need.',
        'Plenty left to dig? Add them to the Miners work detail.',
      ],
      units: idle,
    })
  {
    const digging = jobs.filter((j) => DIG_JOBS.test(j.type)).length
    const miners = skilled(['MINING'])
    const picks = supplies?.picks ?? 0
    const perMiner = digging / Math.max(1, miners.length)
    if (digging)
      add({
        key: 'digging',
        area: 'labor',
        status: perMiner > 40 ? 'attention' : 'good',
        weight: 40,
        title: perMiner > 40 ? 'Put more dwarves on the picks' : 'The digging keeps pace',
        why: `${plural(digging, 'tile is', 'tiles are')} marked for digging, for ${plural(miners.length, 'dwarf', 'dwarves')} who can mine${picks ? `; ${plural(picks, 'pick')} lie unused` : ''}.`,
        steps: compact([
          'Add dwarves to the Miners work detail in the Labor screen. Each fetches a pick for themselves.',
          !picks && "No spare picks: forge some at the metalsmith's forge, or buy them.",
          'Dig what you need first: bedrooms, storage and farms before grand halls.',
        ]),
        units: miners,
      })
  }
  {
    const lacking = compact([
      shops.Kitchen && !skilled(['COOK']).length && 'cooking',
      shops.Still && !skilled(['BREWING']).length && 'brewing',
      (shops.Smelter || shops.MagmaSmelter) && !skilled(['SMELT']).length && 'smelting',
      shops.Loom && !skilled(['WEAVING']).length && 'weaving',
      !skilled(['DIAGNOSE']).length && 'diagnosis',
      (built.FarmPlot ?? 0) && !skilled(['PLANT']).length && 'farming',
      shops.Carpenters && !skilled(['CARPENTRY']).length && 'carpentry',
      shops.Mechanics && !skilled(['MECHANICS']).length && 'mechanics',
    ])
    if (lacking.length)
      add({
        key: 'skills',
        area: 'labor',
        status: 'attention',
        weight: 45,
        title: 'Train for the skills you lack',
        why: `No citizen has ever done any ${list(lacking, 'or')}.`,
        steps: compact([
          'Skills grow with practice: pick a dwarf, enable the labor in the Labor screen, and give them work to do.',
          idle.length && `Idle dwarves are the easiest to train: ${names(idle)}.`,
          'Migrants bring new skills: check each new wave on the dwarves page.',
        ]),
        units: idle,
      })
  }
  {
    const missing = POSITIONS.filter((p) => !holder(p.re))
    add({
      key: 'nobles',
      area: 'labor',
      status: missing.length ? 'attention' : 'good',
      weight: 35,
      title: missing.length
        ? `Appoint a ${list(missing.map((m) => m.label))}`
        : 'The offices are filled',
      why: missing.length
        ? missing.map((m) => `The ${m.label} ${m.why}.`).join(' ')
        : 'A manager, a bookkeeper, a broker, a chief medical dwarf and a militia commander are in office.',
      steps: [
        'Open the Nobles screen and choose someone for each empty office.',
        'Pick dwarves who are not your only hands at a vital job; offices take time away from work.',
      ],
    })
  }

  // Comfort ------------------------------------------------------------------
  {
    const beds = built.Bed ?? 0
    const rooms = (zones.Bedroom ?? 0) + (zones.Dormitory ?? 0)
    add({
      key: 'beds',
      area: 'comfort',
      status: beds >= pop && rooms ? 'good' : beds >= pop / 2 ? 'attention' : 'problem',
      weight: 65,
      title: beds >= pop && rooms ? 'A bed for everyone' : 'Build more beds',
      why: `${plural(beds, 'bed')} and ${plural(rooms, 'bedroom or dormitory', 'bedrooms and dormitories')} for ${plural(pop, 'dwarf', 'dwarves')}.`,
      steps: [
        "Build beds at a carpenter's workshop and draw a bedroom zone around each (Zones → Bedroom).",
        'Dwarves with a room of their own are happier; a dormitory will do for newcomers.',
      ],
    })
  }
  {
    const halls = zones.DiningHall ?? 0
    const tables = built.Table ?? 0
    const chairs = built.Chair ?? 0
    const noTable = feltBy('EatLikeAnimal')
    const good = halls > 0 && tables * 2 >= pop && chairs * 2 >= pop && !noTable.length
    add({
      key: 'dining',
      area: 'comfort',
      status: good ? 'good' : 'attention',
      weight: 45,
      title: good ? 'Somewhere to eat' : 'Set up a dining hall',
      why: `${plural(halls, 'dining hall')}, ${plural(tables, 'table')} and ${plural(chairs, 'chair')}.${noTable.length ? ` ${plural(noTable.length, 'dwarf', 'dwarves')} ate without a table this month.` : ''}`,
      steps: [
        'Place tables and chairs in a room and draw a dining hall zone over it.',
        'Smooth and engrave the walls, and add statues: dwarves enjoy eating somewhere fine.',
      ],
      units: noTable,
    })
  }
  {
    const needy = feltBy('NeedsUnfulfilled')
    add({
      key: 'needs',
      area: 'comfort',
      status: needy.length >= 3 ? 'attention' : 'good',
      weight: needy.length ? 50 : 20,
      title:
        needy.length >= 3
          ? 'Give dwarves somewhere to pray, drink and read'
          : 'Their needs are mostly met',
      why: `${plural(needy.length, 'dwarf', 'dwarves')} had unmet needs this month. ${plural(zones.MeetingHall ?? 0, 'meeting hall')} in the fortress.`,
      steps: [
        'Zones → Meeting hall, then assign it a location: a temple for the gods your dwarves worship, a tavern with drink and music, or a library with bookcases.',
        'Dwarves also need friends, practice at their crafts, a chance to fight or pray, and time off.',
        "Each dwarf's page shows what went through their head lately.",
      ],
      units: needy,
    })
  }
  {
    const unhappy = citizens.filter((u) => u.stress_category <= 2)
    if (unhappy.length)
      add({
        key: 'unhappy',
        area: 'comfort',
        status: unhappy.some((u) => u.stress_category <= 1) ? 'problem' : 'attention',
        weight: 70,
        title: 'Look after unhappy dwarves',
        why: `${unhappy.length === 1 ? `${firstName(unhappy[0])} is ${stressLabel(unhappy[0].stress_category)}` : `${names(unhappy)} are unhappy`}. Unhappiness spreads through tantrums and can end in madness.`,
        steps: [
          'Open their page and read their thoughts: most unhappiness has a cause you can fix.',
          'Give them a finer bedroom, good meals and drink in a mug, and time with friends.',
          'Keep them away from corpses, miasma, rain and fighting.',
        ],
        units: unhappy,
        link: { to: '/fortress/dwarves', label: 'Open the dwarves' },
      })
  }

  // Trade --------------------------------------------------------------------
  {
    const depot = built.TradeDepot ?? 0
    const broker = holder(/broker/i)
    const goods = supplies ? supplies.tradeGoods : 0
    const rough = supplies?.roughGems ?? 0
    const good = depot > 0 && !!broker && goods >= 20
    add({
      key: 'trade',
      area: 'trade',
      status: good ? 'good' : 'attention',
      weight: 30,
      title: good ? 'Ready for caravans' : depot ? 'Make goods to trade' : 'Build a trade depot',
      why: `${depot ? 'A trade depot' : 'No trade depot'}, ${broker ? `${firstName(broker)} as broker` : 'no broker'}, and ${plural(goods, 'craft or gem', 'crafts and gems')} to sell${rough ? `; ${plural(rough, 'rough gem')} could be cut for more` : ''}.`,
      steps: compact([
        !depot &&
          'Build a trade depot where wagons can reach it, three tiles wide from the edge of the map.',
        "Make crafts from stone, bone or wood at a craftsdwarf's workshop: cheap to make, and caravans buy them.",
        rough && `Cut your ${plural(rough, 'rough gem')} at the jeweler's workshop.`,
        'Ask traders for what you cannot make: metal, cloth, food and animals.',
      ]),
    })
  }

  const rank: Record<AdviceStatus, number> = {
    problem: 0,
    attention: 1,
    good: 2,
  }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.weight - a.weight)
}
