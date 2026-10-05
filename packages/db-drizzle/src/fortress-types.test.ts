import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	DFHACK_ACTIONS,
	DUMP_VERSION,
	MAX_CONSOLE_COMMAND,
	TOGGLEABLE_PLUGINS,
	UNIT_ACTIONS,
	checkConsoleCommand,
	decodeTable,
	isDfhackAction,
	isUnitAction,
	splitConsoleCommand,
} from "./fortress-types";

const json = (value: unknown) => `workorder ${JSON.stringify(JSON.stringify(value))}`;

describe("splitConsoleCommand", () => {
	test("splits on runs of whitespace", () => {
		expect(splitConsoleCommand("  orders \t import   library/basic ")).toEqual([
			"orders",
			"import",
			"library/basic",
		]);
	});

	test("keeps quoted stretches together and honours escapes", () => {
		expect(splitConsoleCommand('workorder "{\\"job\\":\\"ConstructBed\\"}"')).toEqual([
			"workorder",
			'{"job":"ConstructBed"}',
		]);
		expect(splitConsoleCommand("caravan 'extend' 3")).toEqual(["caravan", "extend", "3"]);
		expect(splitConsoleCommand("say a\\ b")).toEqual(["say", "a b"]);
		expect(splitConsoleCommand('title ""')).toEqual(["title", ""]);
	});
});

describe("checkConsoleCommand", () => {
	test.each([
		"help",
		"ls",
		"orders list",
		"orders recheck",
		"orders import library/military",
		"enable",
		"enable seedwatch",
		"disable autofarm tailor",
		"workorder -l",
		"workorder MakeBarrel",
		"workorder ConstructBed 5",
		json({ job: "MakeArmor", item_subtype: "ITEM_ARMOR_BREASTPLATE", material: "INORGANIC:IRON" }),
		json([{ job: "SmeltOre", material: "INORGANIC:HEMATITE", amount_total: 2 }]),
		json({ job: "CustomReaction", reaction: "STEEL_MAKING" }),
		"diplomacy",
		"diplomacy 419 peace",
		"diplomacy 419 WAR",
		"force Caravan",
		"force caravan 419",
		"force Diplomat FOREST",
		"force migrants",
		"caravan",
		"caravan extend 7 2",
		"fix/stuck-merchants -n",
		"fix/dead-units",
		"list-agreements all",
		"seedwatch all 30",
	])("allows %s", (command) => {
		expect(checkConsoleCommand(command)).toBeNull();
	});

	test.each<[unknown, string]>([
		[42, "must be text"],
		["   ", "is empty"],
		["x".repeat(MAX_CONSOLE_COMMAND + 1), "longer than"],
		["enable seedwatch\nkill-lua", "One command per line"],
		["help\rls", "One command per line"],
		["kill-lua", "does not run kill-lua"],
		["lua print(1)", "does not run lua"],
		["exterminate goblin", "does not run exterminate"],
		["toString", "does not run toString"],
		["enable autodump", "switches only these"],
		["enable seedwatch autodump", "switches only these"],
		["workorder MakeArmor 5", "cannot say which item"],
		["workorder MakeCrown 2", "does not queue MakeCrown"],
		["workorder ConstructBed lots", "workorder <JobType> <amount>"],
		["workorder ConstructBed 5 6", "workorder <JobType> <amount>"],
		["workorder --file orders.json", "does not run workorder --file"],
		["workorder {not json", "not valid JSON"],
		[json({ job: "MakeArmor", item_subtype: "ITEM_ARMOR_BREASTPLATE" }), "must name the item_subtype"],
		[json({ job: "SmeltOre" }), "must name the material"],
		[json({ job: "CustomReaction", reaction: "MAKE_SOAP" }), "CustomReaction orders only"],
		[json([{ job: "MakeBarrel" }, { job: "MakeWeapon" }]), "MakeWeapon order must name"],
		[json({ job: "MakeBarrel", amount_total: "5" }), "amount_total must be a number"],
		["orders clear", "orders list, sort, recheck"],
		["orders import my-orders", "orders list, sort, recheck"],
		["orders import library/../../save", "orders list, sort, recheck"],
		["orders import library/basic library/smelting", "orders list, sort, recheck"],
		["diplomacy all peace", "diplomacy <civilization id>"],
		["diplomacy 419 alliance", "must be peace or war"],
		["force Megabeast", "Caravan, a Diplomat or Migrants"],
		["force migrants 419", "own civilization"],
		["force caravan 419;lua", "by its id or entity token"],
		["caravan happy x", "are numbers"],
		["caravan list 3", "takes no arguments"],
		["caravan raid", "caravan list, unload"],
		["fix/dead-units now", "no arguments"],
		["fix/stuck-merchants --all", "with -n"],
	])("refuses %p", (command, problem) => {
		expect(checkConsoleCommand(command)).toContain(problem);
	});
});

describe("DFHACK_ACTIONS", () => {
	const actions = Object.entries(DFHACK_ACTIONS);

	test.each(actions)("%s is a command the console check accepts", (_, spec) => {
		expect(checkConsoleCommand([spec.command, ...spec.args].join(" "))).toBeNull();
	});

	test("enable actions name plugins the app may switch", () => {
		for (const [, spec] of actions)
			if (spec.command === "enable")
				expect(TOGGLEABLE_PLUGINS as readonly string[]).toContain(spec.args[0]);
	});

	test("actions that add work orders ask first, since running them twice adds them twice", () => {
		for (const [key, spec] of actions)
			if (spec.command === "orders" && spec.args[0] === "import")
				expect({ key, confirm: "confirm" in spec }).toEqual({ key, confirm: true });
	});

	test("only own keys count as actions", () => {
		expect(isDfhackAction("unsuspend")).toBe(true);
		for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty", "", null, 3])
			expect(isDfhackAction(key)).toBe(false);
	});
});

describe("UNIT_ACTIONS", () => {
	test("every cheat asks first", () => {
		for (const [key, spec] of Object.entries(UNIT_ACTIONS))
			if ("cheat" in spec && spec.cheat)
				expect({ key, confirm: "confirm" in spec }).toEqual({ key, confirm: true });
	});

	test("only own keys count as actions", () => {
		expect(isUnitAction("heal")).toBe(true);
		for (const key of ["nickname", "toString", "constructor", "__proto__", "", undefined])
			expect(isUnitAction(key)).toBe(false);
	});
});

describe("DUMP_VERSION", () => {
	test("is the version the game script writes", () => {
		const lua = readFileSync(
			new URL("../../../apps/worker/src/dfhack/fortress-snapshot.lua", import.meta.url),
			"utf8",
		);
		expect(Number(/^local DUMP_VERSION = (\d+)$/m.exec(lua)?.[1])).toBe(DUMP_VERSION);
	});
});

describe("decodeTable", () => {
	test("turns rows into objects, missing cells into null", () => {
		expect(
			decodeTable<{ id: number; name: string | null }>({
				columns: ["id", "name"],
				rows: [[1, "Urist"], [2]],
			}),
		).toEqual([
			{ id: 1, name: "Urist" },
			{ id: 2, name: null },
		]);
	});

	test("reads nothing from a missing or malformed table", () => {
		expect(decodeTable(null)).toEqual([]);
		expect(decodeTable({ columns: "id", rows: [] } as never)).toEqual([]);
	});
});
