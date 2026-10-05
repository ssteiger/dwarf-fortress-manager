import { describe, expect, test } from "bun:test";
import {
	type FortSnapshot,
	type SnapshotTotals,
	type SnapshotUnit,
	diffSnapshots,
	gameDay,
} from "./snapshots";

const TOTALS: SnapshotTotals = {
	population: 0,
	adults: 0,
	children: 0,
	babies: 0,
	military: 0,
	idle: 0,
	hostiles: 0,
	visitors: 0,
	wealth: null,
	imported: null,
	exported: null,
	stocks: {},
	mood: [0, 0, 0, 0, 0, 0, 0],
};

function dwarf(over: Partial<SnapshotUnit> = {}): SnapshotUnit {
	return {
		name: "Urist Lolumzefon",
		nickname: null,
		hf: 900,
		sex: 1,
		age: 40,
		profession: "Miner",
		stress: 0,
		stress_category: 3,
		skills: { MINING: 4 },
		bonds: {},
		wounds: 0,
		wound: null,
		squad: null,
		positions: [],
		kills: 0,
		...over,
	};
}

function snap(tick: number, units: Record<string, SnapshotUnit>): FortSnapshot {
	return { year: 250, tick, totals: TOTALS, units };
}

const kinds = (prev: FortSnapshot, next: FortSnapshot) =>
	diffSnapshots(prev, next).map((e) => [e.kind, e.data]);

describe("diffSnapshots", () => {
	test("nothing changed, nothing to tell", () => {
		expect(diffSnapshots(snap(0, { 1: dwarf() }), snap(1200, { 1: dwarf() }))).toEqual([]);
	});

	test("dates every event at the later snapshot", () => {
		const [event] = diffSnapshots(snap(0, {}), snap(2400, { 7: dwarf() }));
		expect(event).toMatchObject({ unit_id: 7, hf: 900, kind: "arrived", year: 250, tick: 2400 });
	});

	test("newcomers are born or arrive", () => {
		expect(kinds(snap(0, {}), snap(1200, { 1: dwarf({ age: 0.2 }), 2: dwarf({ age: 31.7 }) }))).toEqual([
			["born", expect.objectContaining({ age: 0 })],
			["arrived", expect.objectContaining({ age: 31 })],
		]);
	});

	test("citizens gone from the list died or left, as the dump says", () => {
		const prev = snap(0, { 1: dwarf(), 2: dwarf({ name: "Kogan" }) });
		const events = diffSnapshots(prev, snap(1200, {}), (id) => (id === 1 ? { dead: true } : null));
		expect(events.map((e) => [e.unit_id, e.kind])).toEqual([
			[1, "died"],
			[2, "left"],
		]);
	});

	test("a skill is told when it reaches a milestone, once per jump", () => {
		const at = (skills: Record<string, number>) => snap(0, { 1: dwarf({ skills }) });
		expect(kinds(at({ MINING: 4 }), at({ MINING: 5 }))).toEqual([
			["skill", expect.objectContaining({ skill: "MINING", from: 4, to: 5 })],
		]);
		expect(kinds(at({ MINING: 5 }), at({ MINING: 8 }))).toEqual([]);
		expect(kinds(at({ MINING: 8 }), at({ MINING: 13 }))).toHaveLength(1);
		expect(kinds(at({ MINING: 15 }), at({ MINING: 16 }))).toHaveLength(1);
		expect(kinds(at({}), at({ MASONRY: 9 }))).toEqual([
			["skill", expect.objectContaining({ skill: "MASONRY", from: 0, to: 9 })],
		]);
	});

	test("profession, office, squad, bond, wounds and kills", () => {
		const prev = snap(0, { 1: dwarf({ positions: ["BROKER"] }) });
		const next = snap(1200, {
			1: dwarf({
				profession: "Swordsdwarf",
				positions: ["MANAGER"],
				squad: "The Axes of Night",
				bonds: { "friend:42": { kind: "friend", hf: 42, name: "Kogan", unit: 3 } },
				wounds: 1,
				wound: "left hand: bruised",
				kills: 2,
			}),
		});
		expect(kinds(prev, next).map(([kind]) => kind)).toEqual([
			"profession",
			"office",
			"office",
			"squad",
			"bond",
			"hurt",
			"kills",
		]);
		expect(kinds(next, prev).map(([kind]) => kind)).toEqual([
			"profession",
			"office",
			"office",
			"squad",
			"healed",
		]);
	});

	test("a dwarf who wavers between unhappy and displeased is told once, until content again", () => {
		const day = (tick: number, stress_category: number, low?: boolean) =>
			snap(tick, { 1: dwarf({ stress_category, low }) });
		const steps = [day(0, 3), day(1, 1), day(2, 2), day(3, 1), day(4, 0), day(5, 3)];
		const told = steps.slice(1).map((next, i) => diffSnapshots(steps[i], next).map((e) => e.kind));
		expect(told).toEqual([["unhappy"], [], [], ["miserable"], ["recovered"]]);
	});
});

describe("gameDay", () => {
	test("counts whole days since the world began", () => {
		expect(gameDay(0, 0)).toBe(0);
		expect(gameDay(0, 1199)).toBe(0);
		expect(gameDay(1, 1200)).toBe(337);
	});
});
