/**
 * The fortress over time: one compact snapshot per in-game day, and the life
 * events that two snapshots in a row differ by. The worker writes both; the
 * web app tells them. Pure functions over the dump, safe for the browser.
 */

import {
	type FortDumpPayload,
	type FortUnit,
	type SheetPerson,
	decodeTable,
} from "./fortress-types";

export const GAME_TICKS_PER_DAY = 1200;
export const GAME_DAYS_PER_YEAR = 336;
export const GAME_TICKS_PER_YEAR = GAME_TICKS_PER_DAY * GAME_DAYS_PER_YEAR;

/** Days since the world began, which keys one snapshot per in-game day. */
export function gameDay(year: number, tick: number): number {
	return year * GAME_DAYS_PER_YEAR + Math.floor(tick / GAME_TICKS_PER_DAY);
}

/** "save_dir:site_id", as the chronicle keys the fortress. */
export function fortKeyOf(
	world: { save_dir: string; site_id: number } | null | undefined,
): string | null {
	return world ? `${world.save_dir}:${world.site_id}` : null;
}

export type BondKind = "spouse" | "lover" | "child" | "friend" | "grudge";

export interface SnapshotBond {
	kind: BondKind;
	hf: number;
	name: string | null;
	unit: number | null;
}

/** What one citizen was on a given day: just enough to tell what changed. */
export interface SnapshotUnit {
	name: string;
	nickname: string | null;
	hf: number;
	sex: number;
	age: number;
	profession: string;
	stress: number;
	stress_category: number;
	/** Unhappy or worse, and not yet content again; carried from day to day. */
	low?: boolean;
	/** Skill token -> rating, for rated skills. */
	skills: Record<string, number>;
	/** `${kind}:${hf}` -> the bond. */
	bonds: Record<string, SnapshotBond>;
	wounds: number;
	/** The first wound, in words, when there is one. */
	wound: string | null;
	squad: string | null;
	positions: string[];
	kills: number;
}

export interface SnapshotTotals {
	population: number;
	adults: number;
	children: number;
	babies: number;
	military: number;
	idle: number;
	hostiles: number;
	visitors: number;
	wealth: number | null;
	imported: number | null;
	exported: number | null;
	/** Stock key -> count, as the summary counts them. */
	stocks: Record<string, number>;
	/** Stress category counts, index 0 = miserable, 6 = ecstatic. */
	mood: number[];
}

export interface FortSnapshot {
	year: number;
	tick: number;
	totals: SnapshotTotals;
	/** Unit id -> the citizen that day. */
	units: Record<string, SnapshotUnit>;
}

const GOOD_RANKS = new Set([
	"childhood_friend",
	"war_buddy",
	"athlete_buddy",
	"scholar_buddy",
	"artistic_buddy",
]);

const BAD_RANKS = new Set([
	"jealous_obsession",
	"jealous_relationship_grudge",
	"grudge",
	"persecution_grudge",
	"religious_persecution_grudge",
	"supernatural_grudge",
	"athletic_rival",
	"business_rival",
]);

const FAMILY_BONDS: Record<string, BondKind> = {
	SPOUSE: "spouse",
	LOVER: "lover",
	CHILD: "child",
};

function bondOf(person: SheetPerson, family: Set<number>): BondKind | null {
	if (person.kind !== "known") return FAMILY_BONDS[person.kind] ?? null;
	if (family.has(person.hf)) return null;
	const love = person.love ?? 0;
	if ((person.rank && BAD_RANKS.has(person.rank)) || love <= -50)
		return "grudge";
	if ((person.rank && GOOD_RANKS.has(person.rank)) || love >= 50)
		return "friend";
	return null;
}

function bondsOf(unit: FortUnit): Record<string, SnapshotBond> {
	const people = unit.sheet && !unit.sheet.error ? unit.sheet.people : [];
	const family = new Set(
		people.filter((p) => p.kind !== "known").map((p) => p.hf),
	);
	const bonds: Record<string, SnapshotBond> = {};
	for (const person of people) {
		const kind = bondOf(person, family);
		if (!kind) continue;
		bonds[`${kind}:${person.hf}`] = {
			kind,
			hf: person.hf,
			name: person.name ?? person.name_english ?? null,
			unit: person.unit ?? null,
		};
	}
	return bonds;
}

function woundOf(unit: FortUnit): string | null {
	const wound = unit.sheet?.wounds?.find((w) => !w.effect);
	if (!wound) return null;
	const where = wound.parts.join(", ");
	const what = [...wound.damage, ...wound.flags].join(", ");
	return [where, what].filter(Boolean).join(": ") || null;
}

function isLivingCitizen(unit: FortUnit): boolean {
	return (
		unit.flags.includes("citizen") &&
		!unit.flags.includes("dead") &&
		!unit.flags.includes("ghost")
	);
}

function snapshotUnit(unit: FortUnit): SnapshotUnit {
	const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null;
	const skills: Record<string, number> = {};
	for (const [token, rating] of sheet
		? sheet.skills.map(([t, r]) => [t, r] as const)
		: unit.skills) {
		if (rating > 0) skills[token] = rating;
	}
	return {
		name: unit.name || unit.readable,
		nickname: unit.nickname || null,
		hf: unit.hist_figure_id,
		sex: unit.sex,
		age: unit.age,
		profession: unit.profession,
		stress: unit.stress,
		stress_category: unit.stress_category,
		skills,
		bonds: bondsOf(unit),
		wounds: unit.wounds,
		wound: unit.wounds > 0 ? woundOf(unit) : null,
		squad: unit.squad_id >= 0 ? (unit.squad ?? "a squad") : null,
		positions: [...unit.positions],
		kills: sheet?.kills ?? 0,
	};
}

/** The day's snapshot of a live dump; null without a world or summary. */
export function snapshotOf(payload: FortDumpPayload): FortSnapshot | null {
	const world = payload.world;
	const summary = payload.summary;
	if (!world || !summary) return null;
	const units: Record<string, SnapshotUnit> = {};
	for (const unit of decodeTable<FortUnit>(payload.units)) {
		if (isLivingCitizen(unit)) units[String(unit.id)] = snapshotUnit(unit);
	}
	const stocks: Record<string, number> = {};
	for (const s of summary.stocks) stocks[s.key] = s.count;
	return {
		year: world.year,
		tick: world.tick,
		totals: {
			population: summary.adults + summary.children + summary.babies,
			adults: summary.adults,
			children: summary.children,
			babies: summary.babies,
			military: summary.military,
			idle: summary.idle,
			hostiles: summary.hostiles,
			visitors: summary.visitors,
			wealth: summary.wealth?.total ?? null,
			imported: summary.wealth?.imported ?? null,
			exported: summary.wealth?.exported ?? null,
			stocks,
			mood: [...summary.mood],
		},
		units,
	};
}

export type LifeEventKind =
	| "arrived"
	| "returned"
	| "born"
	| "died"
	| "left"
	| "skill"
	| "profession"
	| "office"
	| "squad"
	| "bond"
	| "unhappy"
	| "miserable"
	| "recovered"
	| "hurt"
	| "healed"
	| "kills";

/** The facts behind one life event; which fields are set depends on the kind. */
export interface LifeEventData {
	/** The unit's name at the time, and their nickname. */
	name: string;
	nickname?: string | null;
	sex?: number;
	age?: number;
	skill?: string;
	from?: number | string | null;
	to?: number | string | null;
	position?: string;
	squad?: string | null;
	/** Office or squad: true when gained or joined. */
	gained?: boolean;
	bond?: BondKind;
	other_hf?: number;
	other_name?: string | null;
	other_unit?: number | null;
	wound?: string | null;
}

export interface LifeEvent {
	unit_id: number;
	hf: number;
	kind: LifeEventKind;
	year: number;
	tick: number;
	data: LifeEventData;
}

/** Ratings worth a line: Proficient, Professional, Master, Legendary. */
export const SKILL_MILESTONES = [5, 9, 12, 15] as const;

function milestoneCrossed(from: number, to: number): number | null {
	let crossed: number | null = null;
	for (const m of SKILL_MILESTONES) if (from < m && to >= m) crossed = m;
	if (crossed === null && from >= 15 && to > from) crossed = to;
	return crossed;
}

/** A unit seen in the dump but no longer a living citizen. */
export interface GoneUnit {
	dead: boolean;
}

/**
 * What changed between two snapshots of the same fortress, dated at `next`.
 * Also carries `low` over from `prev` into `next`, so a dwarf who wavers
 * between unhappy and displeased is reported once until they are content.
 * `gone` says, for citizens no longer listed, whether the dump shows them dead.
 */
export function diffSnapshots(
	prev: FortSnapshot,
	next: FortSnapshot,
	gone: (unitId: number) => GoneUnit | null = () => null,
): LifeEvent[] {
	const events: LifeEvent[] = [];
	const at = { year: next.year, tick: next.tick };
	const push = (
		unitId: string,
		unit: SnapshotUnit,
		kind: LifeEventKind,
		data: Omit<LifeEventData, "name"> = {},
	) => {
		events.push({
			unit_id: Number(unitId),
			hf: unit.hf,
			kind,
			...at,
			data: {
				name: unit.name,
				nickname: unit.nickname,
				sex: unit.sex,
				...data,
			},
		});
	};

	for (const [id, was] of Object.entries(prev.units)) {
		if (next.units[id]) continue;
		const fate = gone(Number(id));
		push(id, was, fate?.dead ? "died" : "left");
	}

	for (const [id, now] of Object.entries(next.units)) {
		const was = prev.units[id];
		if (!was) {
			now.low = now.stress_category <= 1;
			push(id, now, now.age < 1 ? "born" : "arrived", {
				age: Math.floor(now.age),
			});
			continue;
		}

		for (const [skill, rating] of Object.entries(now.skills)) {
			const crossed = milestoneCrossed(was.skills[skill] ?? 0, rating);
			if (crossed !== null)
				push(id, now, "skill", {
					skill,
					from: was.skills[skill] ?? 0,
					to: rating,
				});
		}

		if (now.profession !== was.profession)
			push(id, now, "profession", { from: was.profession, to: now.profession });

		for (const position of now.positions)
			if (!was.positions.includes(position))
				push(id, now, "office", { position, gained: true });
		for (const position of was.positions)
			if (!now.positions.includes(position))
				push(id, now, "office", { position, gained: false });

		if (now.squad !== was.squad) {
			if (now.squad) push(id, now, "squad", { squad: now.squad, gained: true });
			else push(id, now, "squad", { squad: was.squad, gained: false });
		}

		for (const [key, bond] of Object.entries(now.bonds)) {
			if (was.bonds[key]) continue;
			push(id, now, "bond", {
				bond: bond.kind,
				other_hf: bond.hf,
				other_name: bond.name,
				other_unit: bond.unit,
			});
		}

		const wasLow = was.low ?? was.stress_category <= 1;
		now.low = wasLow ? now.stress_category < 3 : now.stress_category <= 1;
		if (!wasLow && now.low)
			push(id, now, now.stress_category <= 0 ? "miserable" : "unhappy", {
				from: was.stress_category,
				to: now.stress_category,
			});
		else if (wasLow && now.low && was.stress_category > 0 && now.stress_category <= 0)
			push(id, now, "miserable", {
				from: was.stress_category,
				to: now.stress_category,
			});
		else if (wasLow && !now.low)
			push(id, now, "recovered", {
				from: was.stress_category,
				to: now.stress_category,
			});

		if (was.wounds === 0 && now.wounds > 0)
			push(id, now, "hurt", { wound: now.wound });
		else if (was.wounds > 0 && now.wounds === 0) push(id, now, "healed");

		if (now.kills > was.kills)
			push(id, now, "kills", { from: was.kills, to: now.kills });
	}
	return events;
}
