/**
 * Shapes shared by the DFHack worker (writer) and the web app (reader).
 *
 * The worker's Lua script emits every collection in row form
 * (`columns` + `rows`) to keep the JSON small. `decodeTable` turns that back
 * into objects keyed by column name.
 */

export type FortStatus = "live" | "menu" | "offline";

/** How often the worker marks `fort_worker.seen_at` while it runs. */
export const WORKER_HEARTBEAT_MS = 10_000;

export interface RowTable {
	columns: string[];
	rows: unknown[][];
}

export function decodeTable<T extends object>(
	table: RowTable | null | undefined,
): T[] {
	if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows))
		return [];
	const columns = table.columns;
	return table.rows.map((row) => {
		const obj: Record<string, unknown> = {};
		for (let i = 0; i < columns.length; i++) {
			obj[columns[i]] = row[i] ?? null;
		}
		return obj as T;
	});
}

export interface FortWorld {
	name: string;
	name_native: string;
	save_dir: string;
	site_id: number;
	site_name: string;
	site_name_native: string;
	civ_id: number;
	group_id: number;
	year: number;
	tick: number;
	month: number;
	day: number;
	month_name: string;
	season: string;
	map_x: number;
	map_y: number;
	map_z: number;
	df_version: string;
	dfhack_version: string;
}

export interface FortStockEntry {
	key: string;
	label: string;
	count: number;
}

export interface FortAlert {
	kind: "cancellation" | "stress" | "injury" | "hostile" | "supply" | "mood";
	title: string;
	detail: string;
	count: number;
	severity: "info" | "warning" | "danger";
}

export interface FortSummary {
	adults: number;
	children: number;
	babies: number;
	working: number;
	idle: number;
	military: number;
	visitors: number;
	merchants: number;
	hostiles: number;
	tame_animals: number;
	war_animals: number;
	/** Stress category counts, index 0 = miserable, 6 = ecstatic. */
	mood: number[];
	jobs_total: number;
	jobs_suspended: number;
	stocks: FortStockEntry[];
	alerts: FortAlert[];
	wealth: {
		total: number;
		weapons: number;
		armor: number;
		furniture: number;
		other: number;
		architecture: number;
		displayed: number;
		held: number;
		imported: number;
		exported: number;
	} | null;
	items_total: number;
	buildings_total: number;
}

/**
 * One tissue layer the graphics raws can condition on (skin, hair, beard,
 * eyebrows, eyes): its colour token and, for styleable hair, its length,
 * styling, curliness and density. `bps` lists the body part tokens sharing it.
 */
export interface UnitTissue {
	bps: string[];
	/** Body part category, e.g. HEAD. */
	cat: string;
	/** Layer name, e.g. HAIR, SKIN, CHIN_WHISKERS. */
	layer: string;
	/** Descriptor colour token, e.g. DARK_BROWN. */
	color?: string | null;
	length?: number | null;
	/** NEATLY_COMBED, BRAIDED, DOUBLE_BRAIDS, PONY_TAILS, CLEAN_SHAVEN or null when unstyled. */
	style?: string | null;
	curly?: number | null;
	dense?: number | null;
}

/** An item the unit wears or wields, with the facts item conditions test. */
export interface UnitWornItem {
	item_id: number;
	/** Inventory mode: Worn, Weapon, Strapped, Piercing, Flask, WrappedAround. */
	mode: string;
	/** Body part token (RH, UB) and category (BODY_UPPER, HEAD) it is on. */
	bp: string | null;
	cat: string | null;
	/** Item type token (HELM, ARMOR, GLOVES, SHOES, PANTS, SHIELD, WEAPON, ...). */
	type: string | null;
	/** Item subtype token (ITEM_HELM_CAP), null for items without one. */
	subtype: string | null;
	quality: number;
	/** INORGANIC, PLANT, CREATURE, BUILTIN. */
	material_type: string | null;
	/** Descriptor colour token of the material, or of the dye when dyed. */
	color: string | null;
	dyed: boolean;
	/** ANY_WOOD_MATERIAL, WOVEN_ITEM, IS_CRAFTED_ARTIFACT, NOT_ARTIFACT, GROWN_NOT_CRAFTED, ... */
	flags: string[];
}

/**
 * Facts about a procedurally generated race (forgotten beast, titan, demon,
 * night creature), from which its sprite is assembled out of the beast kit.
 */
export interface GeneratedLook {
	kind:
		| "FEATURE_BEAST"
		| "TITAN"
		| "DEMON"
		| "NIGHT_CREATURE"
		| "MEGABEAST"
		| "OTHER";
	/** The generator's description, e.g. "An enormous hairy tarantula. It has a long, swinging trunk ...". */
	description: string;
	/** Body part category -> count (LEG_REAR: 6, WING: 2, SHELL: 1, EYE: 2, ...). */
	cats: Record<string, number>;
	/** Tissue ids (SKIN, FEATHER, SCALE, CHITIN, ...; UNIFORM_TIS when "composed of" a material). */
	tissues: string[];
	/** Descriptor colour token of the outer covering or body material. */
	color: string | null;
	flier: boolean;
}

/**
 * Everything the game's layered graphics read off a unit, dumped so the web
 * app can evaluate the same layer conditions. Null in dumps older than this.
 */
export interface UnitLook {
	/** Top of the profession tree: MINER, FARMER, STANDARD, CHILD, ... */
	profession_category: string | null;
	/** SYN_CLASS tokens of active syndromes (ZOMBIE, VAMPCURSE, NECROMANCER, ...). */
	syn_classes: string[];
	haul_count: number;
	body_size: number;
	tissues: UnitTissue[];
	/** [body part token, category, modifier type, value], e.g. ["NOSE","NOSE","ROUND_VS_NARROW",120]. */
	bp_modifiers: [string, string, string, number][];
	/** [modifier type, value] for body-wide modifiers (HEIGHT, BROADNESS, LENGTH). */
	body_modifiers: [string, number][];
	/** [token, category, missing] for every body part of the caste. */
	parts: [string, string, 0 | 1][];
	worn: UnitWornItem[];
	/** Present for procedurally generated races. */
	generated?: GeneratedLook | null;
}

/** Someone a unit is linked to (family, lovers, masters) or has an opinion of. */
export interface SheetPerson {
	/** Historical figure id. */
	hf: number;
	/** A histfig_hf_link_type (MOTHER, SPOUSE, CHILD, LOVER, MASTER, ...), or "known" for an opinion. */
	kind: string;
	/** As the fortress writes names, e.g. "Urist Momuzlolor". */
	name: string | null;
	name_english: string | null;
	race: string | null;
	sex: number;
	alive: boolean;
	/** Their unit id; they may not be on the map. */
	unit: number | null;
	/** Opinions only, -100 to 100. Love sets the game's word for it: Friend above 49, Kindred spirit at 100, Disliked at -50 and below. */
	love?: number;
	trust?: number;
	respect?: number;
	loyalty?: number;
	fear?: number;
	/** How many times they have met. */
	met?: number;
	/** A vague_relationship_type such as childhood_friend, war_buddy, grudge, jealous_obsession. */
	rank?: string | null;
	/** reputation_type tokens they hold the other to: Friendly, Brawler, Storyteller, ... */
	attitude?: string[];
	/** The same figure is also listed through a family link. */
	family?: boolean;
}

export interface SheetWound {
	/** Body part names, e.g. "right lung". */
	parts: string[];
	/** "broken", "cut open", "tendon torn", "bruise", "scarred", "needs setting", ... */
	damage: string[];
	/** "severed", "infected", "sutured", "diagnosed", "something stuck in it". */
	flags: string[];
	pain: number;
	bleeding: number;
	/** The syndrome that caused it, e.g. "inebriation". */
	syndrome?: string | null;
	/** Only a syndrome's effect, not an injury (drink shows up this way). */
	effect?: boolean;
}

/**
 * The rest of what the game's unit screens show, for the character pages.
 * Null for units without a creature raw; `error` when reading it failed.
 */
export interface UnitSheet {
	/** [token, "P" physical | "M" mental, effective value, potential, the caste's 7 range cutoffs]. */
	attributes: [string, "P" | "M", number, number, number[]][];
	/** Every skill with a rating or experience: [token, rating, experience toward the next level, rust, skill class, whether its labor is enabled (null for skills without one)]. */
	skills: [string, number, number, number, string | null, boolean | null][];
	/** [need_type token, focus level (400 met, below -999 distracted), drain rate, deity for prayer], least met first. */
	needs: [string, number, number, string | null][];
	/** [unitpref_type token, what]. */
	preferences: [string, string][];
	/** [goal_type token, realised, the game's short name]. */
	dreams: [string, boolean, string | null][];
	/** [thought, emotion, strength, year, year tick, "short" | "long"]. */
	memories?: [string, string, number, number, number, "short" | "long"][];
	/** Memories that changed who they are: [thought, emotion, year, tick, facet, old, new, value, old, new]. */
	core_memories?: [
		string,
		string,
		number,
		number,
		string | null,
		number | null,
		number | null,
		string | null,
		number | null,
		number | null,
	][];
	people: SheetPerson[];
	/** [name, worship strength 0–100, spheres], most devout first. */
	deities: [string, number, string[]][];
	/** [entity name, historical_entity_type, histfig_entity_link_type]. */
	groups: [string, string, string][];
	wounds: SheetWound[];
	syndromes: string[];
	work_details: string[];
	/** [year, year tick]. */
	birth?: [number, number] | null;
	kills?: number | null;
	pregnant?: boolean | null;
	/** Player-set profession title; null when they go by their profession. */
	custom_profession?: string | null;
	squad_position?: number | null;
	/** Weighted need satisfaction as a percentage; 100 is undistracted. */
	focus?: number | null;
	longterm_stress?: number | null;
	/** 0–100, how used to violence they are. */
	combat_hardened?: number | null;
	likes_outdoors?: number | null;
	error?: string;
}

export interface FortUnit {
	id: number;
	name: string;
	name_english: string;
	readable: string;
	/** Player-assigned nickname; null when the unit has none. */
	nickname: string | null;
	race: string;
	caste: string;
	sex: number;
	age: number;
	profession: string;
	x: number | null;
	y: number | null;
	z: number | null;
	stress: number;
	stress_category: number;
	job_id: number | null;
	job: string | null;
	squad_id: number;
	squad: string | null;
	wounds: number;
	blood: number | null;
	blood_max: number | null;
	hunger: number;
	thirst: number;
	sleepiness: number;
	mood: string | null;
	flags: string[];
	skills: [string, number][];
	inventory: [number, string][];
	positions: string[];
	hist_figure_id: number;
	civ_id: number;
	/** Raw creature token (DWARF, BIRD_PEAFOWL_BLUE); null in dumps older than this column. */
	race_id: string | null;
	/** Raw caste token (MALE, FEMALE); null in older dumps. */
	caste_id: string | null;
	/** Appearance and wardrobe for exact sprite rendering; null in older dumps. */
	look: UnitLook | null;
	/** [facet token, 0–100] for traits the game would remark on. Absent in older dumps. */
	traits?: [string, number][] | null;
	/** [value token, strength] for beliefs, strongest first. Absent in older dumps. */
	values?: [string, number][] | null;
	/** [thought, emotion, strength, year, year tick], newest first. Absent in older dumps. */
	thoughts?: [string, string, number, number, number][] | null;
	/** Attributes, needs, preferences, people and more. Absent in older dumps and in unit lists. */
	sheet?: UnitSheet | null;
}

export interface FortItem {
	id: number;
	type: string;
	subtype: string | null;
	description: string;
	material: string;
	stack: number;
	quality: string;
	wear: number;
	x: number | null;
	y: number | null;
	z: number | null;
	flags: string[];
	container_id: number | null;
	holder_unit_id: number | null;
	holder_building_id: number | null;
	value: number;
	/** Raw subtype token (ITEM_WEAPON_PICK), for the item's sprite; null in older dumps. */
	subtype_id: string | null;
	/** METAL, STONE, WOOD, GLASS, GEM, LEATHER, BONE, SHELL, CLOTH, SOAP, PLANT; null in older dumps. */
	mat_class: string | null;
	/** Descriptor colour token of the material (COPPER, GRAY); null in older dumps. */
	color: string | null;
	/** Creature token for corpses, body parts, remains, fish, vermin, eggs; null otherwise or in older dumps. */
	race_id: string | null;
	caste_id: string | null;
	/** Plant token for seeds, plants, growths, and plant-based drinks; null otherwise or in older dumps. */
	plant_id: string | null;
	/** Set corpse_flags of a body part (bone, skull, skin, horn, ...); null otherwise or in older dumps. */
	corpse_flags: string[] | null;
}

export interface FortBuilding {
	id: number;
	type: string;
	subtype: string | null;
	custom: string | null;
	name: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	z: number;
	cx: number;
	cy: number;
	stage: number;
	max_stage: number;
	stockpile_items: number | null;
	jobs: number[];
	assigned_units: number[];
	room: string | null;
}

export interface FortJob {
	id: number;
	type: string;
	name: string;
	x: number;
	y: number;
	z: number;
	suspended: boolean;
	repeat: boolean;
	worker_id: number | null;
	building_id: number | null;
	order_id: number;
	items: number;
}

export interface FortAnnouncement {
	id: number;
	year: number;
	time: number;
	type: string;
	text: string;
	repeat: number;
	x: number;
	y: number;
	z: number;
}

export interface FortDumpPayload {
	status: FortStatus;
	dump_version: number;
	elapsed_ms: number;
	world: FortWorld | null;
	summary: FortSummary | null;
	units: RowTable | null;
	items: RowTable | null;
	buildings: RowTable | null;
	jobs: RowTable | null;
	announcements: RowTable | null;
	map: FortMapPayload | null;
	error?: string;
}

/**
 * Map blocks are 16x16 tiles. `tiles` and `flags` are run-length encoded as
 * flat `[value, count, value, count, ...]` arrays walked x-major
 * (x = 0..15, y = 0..15).
 *
 * `flags` bit layout (a masked copy of DF's tile designation):
 *   bits 0-2  liquid amount (0-7)
 *   bit  3    stockpile tile
 *   bits 4-6  dig designation (0 none, 1 default, 2 up/down stair, 3 channel, 4 ramp, 5 down stair, 6 up stair)
 *   bits 7-8  smooth (0 none, 1 smooth, 2 engraved)
 *   bit  9    hidden (not yet revealed to the player)
 *   bit  14   light
 *   bit  15   subterranean
 *   bit  16   outside
 *   bit  21   liquid is magma (otherwise water)
 *   bits 24-25 traffic (0 normal, 1 low, 2 high, 3 restricted)
 */
export type FortMapBlock = [
	z: number,
	bx: number,
	by: number,
	tiles: number[],
	flags: number[],
];

export interface FortTiletype {
	name: string;
	shape: string;
	material: string;
}

export interface FortMapPayload {
	x_count: number;
	y_count: number;
	z_count: number;
	tiletypes: Record<string, FortTiletype>;
	blocks: FortMapBlock[];
}

export const FORT_FLAG = {
	LIQUID_MASK: 0x7,
	PILE: 0x8,
	DIG_SHIFT: 4,
	DIG_MASK: 0x7,
	SMOOTH_SHIFT: 7,
	SMOOTH_MASK: 0x3,
	HIDDEN: 0x200,
	LIGHT: 0x4000,
	SUBTERRANEAN: 0x8000,
	OUTSIDE: 0x10000,
	MAGMA: 0x200000,
	TRAFFIC_SHIFT: 24,
	TRAFFIC_MASK: 0x3,
} as const;

/**
 * The DFHack commands the web app may ask the worker to run. The web app
 * sends only the key; the worker looks up the exact command here, so nothing
 * else can reach the game's console.
 */
export interface DfhackActionSpec {
	command: string;
	args: readonly string[];
	/** Button text. */
	label: string;
	/** What happens in the game, in a sentence. */
	what: string;
	/** Asked before running, for commands that are not safe to repeat. */
	confirm?: string;
}

export const DFHACK_ACTIONS = {
	unsuspend: {
		command: "unsuspend",
		args: [],
		label: "Resume suspended jobs",
		what: "Resumes constructions suspended by items in the way, unreachable materials or scared workers. Jobs that would block others stay suspended.",
	},
	suspendmanager: {
		command: "enable",
		args: ["suspendmanager"],
		label: "Keep resuming stuck jobs",
		what: "Turns on suspendmanager, which keeps resuming stuck constructions and holds back ones that would trap a worker or cave in.",
	},
	burial: {
		command: "burial",
		args: [],
		label: "Make tombs for coffins",
		what: "Creates a tomb zone for every built coffin that is not in one yet, so the dead can be buried there.",
	},
	tailor: {
		command: "enable",
		args: ["tailor"],
		label: "Keep dwarves clothed",
		what: "Turns on tailor: once a day it swaps tattered clothes for fresh ones and orders more clothes when there are too few.",
	},
	seedwatch: {
		command: "enable",
		args: ["seedwatch"],
		label: "Protect seeds from cooks",
		what: "Turns on seedwatch: plants and seeds are kept out of the kitchen while fewer than 30 of that seed are left.",
	},
	autofarm: {
		command: "enable",
		args: ["autofarm"],
		label: "Manage crops automatically",
		what: "Turns on autofarm: farm plots are planted with whatever crop runs lowest, as long as there are seeds.",
	},
	recheckOrders: {
		command: "orders",
		args: ["recheck"],
		label: "Re-check work orders",
		what: "Makes the manager re-check every work order's conditions, which stops orders whose materials ran out from spamming cancellations.",
	},
	sortOrders: {
		command: "orders",
		args: ["sort"],
		label: "Sort work orders",
		what: "Puts one-time orders ahead of repeating ones, so they get done.",
	},
	basicOrders: {
		command: "orders",
		args: ["import", "library/basic"],
		label: "Add basic work orders",
		what: "Adds DFHack's library of standing orders for drink, food, mugs, barrels, bins, cloth and more, each with a stock condition.",
		confirm:
			"This adds a few dozen work orders on top of the ones you have. Running it again adds them again. Add them?",
	},
	smeltingOrders: {
		command: "orders",
		args: ["import", "library/smelting"],
		label: "Add smelting work orders",
		what: "Adds DFHack's standing orders to smelt the ores you have into bars, each with a stock condition.",
		confirm:
			"This adds a set of smelting orders on top of the ones you have. Running it again adds them again. Add them?",
	},
	furnaceOrders: {
		command: "orders",
		args: ["import", "library/furnace"],
		label: "Add furnace work orders",
		what: "Adds DFHack's standing orders for furnace work such as charcoal and coke for fuel, each with a stock condition.",
		confirm:
			"This adds a set of furnace orders on top of the ones you have. Running it again adds them again. Add them?",
	},
	combine: {
		command: "combine",
		args: ["all", "-q"],
		label: "Merge partial stacks",
		what: "Merges half-empty stacks of food, drink, ammo and other goods in every stockpile, which frees barrels, bins and stockpile space.",
	},
	banCooking: {
		command: "ban-cooking",
		args: ["all"],
		label: "Keep brewables and seeds from cooks",
		what: "Stops cooks from using up seeds, brewable plants, honey, milk, oil, tallow and thread plants, which are worth more as what they make.",
	},
	cleanowned: {
		command: "cleanowned",
		args: ["X"],
		label: "Take away tattered clothes",
		what: "Confiscates rotten and badly worn items your dwarves own and marks them for the garbage dump, so they change into fresh clothes from the stores.",
		confirm:
			"Your dwarves lose the worn-out items they own, and need new clothes in the stores to change into. Go ahead?",
	},
} as const satisfies Record<string, DfhackActionSpec>;

export type DfhackAction = keyof typeof DFHACK_ACTIONS;

export function isDfhackAction(value: unknown): value is DfhackAction {
	return typeof value === "string" && Object.hasOwn(DFHACK_ACTIONS, value);
}

/*
 * Console commands: DFHack commands as typed, suggested by the assistant and
 * confirmed by the player one at a time. Unlike DFHACK_ACTIONS there is no
 * whitelist; the checks below only keep out what would end the session.
 */

export const MAX_CONSOLE_COMMAND = 2000;

/** Commands that quit the game, saved or not; nothing worth confirming. */
export const BLOCKED_CONSOLE_COMMANDS: readonly string[] = ["die"];

/**
 * Split a console line the way DFHack's own console does: on whitespace,
 * keeping quoted stretches together and honouring backslash escapes, so
 * `workorder "{\"job\":\"ConstructBed\"}"` arrives as two arguments.
 */
export function splitConsoleCommand(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inToken = false;
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\" && i + 1 < text.length) {
			current += text[++i];
			inToken = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			inToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (inToken) {
				tokens.push(current);
				current = "";
				inToken = false;
			}
			continue;
		}
		current += ch;
		inToken = true;
	}
	if (inToken) tokens.push(current);
	return tokens;
}

/** The problem with a console command, or null when it may be queued. */
export function checkConsoleCommand(text: unknown): string | null {
	if (typeof text !== "string") return "The command must be text";
	const trimmed = text.trim();
	if (!trimmed) return "The command is empty";
	if (trimmed.length > MAX_CONSOLE_COMMAND)
		return `The command is longer than ${MAX_CONSOLE_COMMAND} characters`;
	if (/[\r\n]/.test(trimmed)) return "One command per line";
	const tokens = splitConsoleCommand(trimmed);
	if (!tokens.length) return "The command is empty";
	const name = tokens[0].toLowerCase();
	if (BLOCKED_CONSOLE_COMMANDS.includes(name))
		return `"${tokens[0]}" quits the game, so the app will not run it`;
	return null;
}

/**
 * What the web app may do to a single unit. It sends the key, the unit id and,
 * for `title`, the text; unit-action.lua in the worker does the rest.
 */
export interface UnitActionSpec {
	label: string;
	/** What happens in the game, in a sentence. */
	what: string;
	/** The DFHack console command with the same effect; `{id}` and `{text}` are filled in. */
	command: string;
	/** Does something the game itself never would. */
	cheat?: boolean;
	/** Asked before running. */
	confirm?: string;
}

export const MAX_UNIT_TITLE = 40;

export const UNIT_ACTIONS = {
	reveal: {
		label: "Show in game",
		what: "Centres the game's view on them and marks their tile until you click elsewhere.",
		command:
			"lua dfhack.gui.revealInDwarfmodeMap(xyz2pos(dfhack.units.getPosition(df.unit.find({id}))), true, true)",
	},
	title: {
		label: "Give a title",
		what: "Sets a custom profession, which the game shows in place of their profession everywhere. An empty title brings the usual one back.",
		command: 'lua df.unit.find({id}).custom_profession = dfhack.utf2df("{text}")',
	},
	calm: {
		label: "Clear their stress",
		what: "Wipes out built-up stress and ends a tantrum, depression or obliviousness, as if the bad memories had never happened.",
		command:
			"lua reqscript('remove-stress').removeStress(df.unit.find({id}), -1000000)",
		cheat: true,
		confirm:
			"This rewrites their mind: every bit of stress is gone at once, which the game would never do. Go ahead?",
	},
	fillneeds: {
		label: "Fulfil every need",
		what: "Marks every need as just met, so they are fully focused again, and clears their stress too.",
		command: "fillneeds -unit {id}",
		cheat: true,
		confirm:
			"Every need is marked as met and their stress is cleared, which the game would never do on its own. Go ahead?",
	},
	heal: {
		label: "Heal completely",
		what: "Removes every wound, refills their blood, grows back lost limbs and resets hunger, thirst and sleep. Syndromes stay.",
		command: "full-heal -unit {id}",
		cheat: true,
		confirm:
			"All their wounds vanish and lost limbs grow back, which the game would never do. Go ahead?",
	},
} as const satisfies Record<string, UnitActionSpec>;

export type UnitAction = keyof typeof UNIT_ACTIONS;

export function isUnitAction(value: unknown): value is UnitAction {
	return typeof value === "string" && Object.hasOwn(UNIT_ACTIONS, value);
}

export const STRESS_LABELS = [
	"miserable",
	"unhappy",
	"displeased",
	"content",
	"pleased",
	"happy",
	"ecstatic",
] as const;

export const DF_MONTHS = [
	"Granite",
	"Slate",
	"Felsite",
	"Hematite",
	"Malachite",
	"Galena",
	"Limestone",
	"Sandstone",
	"Timber",
	"Moonstone",
	"Opal",
	"Obsidian",
] as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Generic legends record payload: the vanilla XML element converted to JSON,
 * with the legends_plus element (if any) merged under `plus`.
 */
export type LegendsPayload = JsonObject;

export const LEGENDS_KINDS = [
	"region",
	"underground_region",
	"landmass",
	"mountain_peak",
	"river",
	"site",
	"world_construction",
	"artifact",
	"historical_figure",
	"entity_population",
	"entity",
	"historical_event",
	"historical_event_collection",
	"historical_era",
	"written_content",
	"poetic_form",
	"musical_form",
	"dance_form",
	"creature_raw",
	"identity",
] as const;

export type LegendsKind = (typeof LEGENDS_KINDS)[number];
