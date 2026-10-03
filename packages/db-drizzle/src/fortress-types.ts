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

/**
 * The steps of one game read, in order. `worker` is the web app's own step
 * until the worker picks a request up; fortress-snapshot.lua reports `world`
 * through `map`; `map` only comes along when the map is due.
 */
export const DUMP_STEPS = [
	"worker",
	"game",
	"world",
	"units",
	"items",
	"buildings",
	"jobs",
	"announcements",
	"writing",
	"map",
	"store",
] as const;

export type DumpStep = (typeof DUMP_STEPS)[number];

export function isDumpStep(value: string): value is DumpStep {
	return (DUMP_STEPS as readonly string[]).includes(value);
}

export function dumpSteps(withMap: boolean): DumpStep[] {
	return DUMP_STEPS.filter((step) => withMap || step !== "map");
}

const DUMP_PROGRESS_STATES = ["running", "done", "menu", "offline", "error"] as const;

/** `running` until the read ends; the rest say how it ended. */
export type DumpProgressState = (typeof DUMP_PROGRESS_STATES)[number];

/** Where the latest read is, kept by the worker in `fort_worker.dump_progress`. */
export interface DumpProgress {
	/** The step the read is on, or the one it ended on. */
	step: DumpStep;
	state: DumpProgressState;
	withMap: boolean;
	/** When the worker started the read. */
	startedAt: string;
	/** What the read found, or why it stopped. */
	detail: string | null;
}

export function parseDumpProgress(value: unknown): DumpProgress | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	if (typeof v.step !== "string" || !isDumpStep(v.step)) return null;
	const state = DUMP_PROGRESS_STATES.find((s) => s === v.state);
	if (!state || typeof v.startedAt !== "string") return null;
	return {
		step: v.step,
		state,
		withMap: v.withMap === true,
		startedAt: v.startedAt,
		detail: typeof v.detail === "string" ? v.detail : null,
	};
}

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

/**
 * A noble's mandate: a production order ("Make"), an export ban ("Export")
 * or a guild's demand. The timeout counts up to its limit; DFHack warns once
 * fewer than MANDATE_WARN_LEFT remain, about a month.
 */
export interface FortMandate {
	/** mandate_type: Make, Export or Guild. */
	kind: string;
	unit_id: number | null;
	noble: string | null;
	/** The noble's office, e.g. "mayor". */
	position: string | null;
	/** "quivers", "steel bars". */
	item: string;
	amount_total: number;
	amount_remaining: number;
	timeout_counter: number;
	timeout_limit: number;
	hammerstrikes: number | null;
	prison_time: number | null;
}

export const MANDATE_WARN_LEFT = 2500;

/** A room a noble has demanded, by the game's demand_room (Office, Bedroom, DiningRoom, Tomb). */
export interface FortDemand {
	unit_id: number;
	name: string;
	position: string | null;
	place: string;
	item: string | null;
	timeout_counter: number;
	timeout_limit: number;
}

/** A caravan on its way, at the depot or leaving. */
export interface FortCaravan {
	index: number;
	entity_id: number;
	civ: string | null;
	civ_native: string | null;
	/** Race adjective, e.g. "dwarven", "human". */
	race: string | null;
	/** The caravan comes from the fortress's own civilization. */
	own_civ: boolean;
	/** caravan_state trade_state: None, Approaching, AtDepot, Leaving or Stuck. */
	state: string;
	/** Divide by CARAVAN_TICKS_PER_DAY for days, as DFHack's caravan command does. */
	time_remaining: number;
	/** casualty, hardship, seized, offended. */
	trouble: string[];
}

export const CARAVAN_TICKS_PER_DAY = 120;

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
	/** Absent in dumps older than version 9. */
	mandates?: FortMandate[];
	demands?: FortDemand[];
	caravans?: FortCaravan[];
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
	/**
	 * True while the game colours clothing by profession, i.e. with
	 * DISPLAY_CLOTHING_WITH_DYES_IN_FORT_MODE:NO; otherwise clothes show their
	 * dye or material. Absent in dumps older than version 10.
	 */
	profession_colors?: boolean | null;
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

/** One demand of a strange mood, as `showmood` lists it. */
export interface StrangeMoodNeed {
	/** "silk cloth", "rough gem", "leather", "bones". */
	label: string;
	/** item_type token, e.g. CLOTH; NONE for body parts. */
	item_type: string;
	/** In whole items: three cloth, not 30000. */
	need: number;
	have: number;
	/** Matching items nobody holds, claims or has forbidden; only for demands still short. */
	free?: number;
}

/** What a dwarf in a strange mood (Fey, Secretive, Possessed, Macabre, Fell) is after. */
export interface StrangeMood {
	type: string;
	/** job_skill token of the artifact they will make, e.g. CLOTHESMAKING. */
	skill: string | null;
	/** unit.job.mood_timeout as the game holds it. */
	timeout: number | null;
	job_id: number | null;
	/** StrangeMoodCrafter, StrangeMoodWeaver, ... */
	job: string | null;
	/** The workshop they claimed; null until they have one. */
	building_id: number | null;
	/** True once they have everything and started work. */
	working?: boolean | null;
	/** Empty until a workshop is claimed: the demands come with it. */
	needs: StrangeMoodNeed[];
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
	/** Set while in a strange mood. Absent in dumps older than version 9. */
	strange_mood?: StrangeMood | null;
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
	/** Descriptor colour token of the dye when dyed, else of the material (COPPER, GRAY); null in older dumps. */
	color: string | null;
	/** Creature token for corpses, body parts, remains, fish, vermin, eggs; null otherwise or in older dumps. */
	race_id: string | null;
	caste_id: string | null;
	/** Plant token for seeds, plants, growths, and plant-based drinks; null otherwise or in older dumps. */
	plant_id: string | null;
	/** Set corpse_flags of a body part (bone, skull, skin, horn, ...); null otherwise or in older dumps. */
	corpse_flags: string[] | null;
	/** Historical figure who made it (see the figures table); only crafted items. Absent before version 9. */
	maker_hf?: number | null;
	/** Unit who owns it. Absent before version 9. */
	owner_id?: number | null;
	/** Its artifact record (see the artifacts table). Absent before version 9. */
	artifact_id?: number | null;
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
	/** [what, how many, how many brought] per requirement, e.g. ["iron bars", 3, 2]. Absent before version 9. */
	needs?: [string, number, number][];
	/** working, bringing, fetching, item_lost; null while it waits. Absent before version 9. */
	state?: string | null;
}

/** A manager work order. */
export interface FortOrder {
	id: number;
	/** job_type token. */
	job: string;
	/** The reaction's name or the job's caption: "brew drink from plant", "Make Barrel". */
	label: string;
	/** Material and item, e.g. "steel breastplate", "wood". */
	detail: string | null;
	amount_left: number;
	amount_total: number;
	/** OneTime, Daily, Monthly, Seasonally, Yearly. */
	frequency: string;
	/** Checked by the manager. */
	validated: boolean;
	/** Its conditions hold, so its jobs are queued. */
	active: boolean;
	workshop_id: number | null;
	max_workshops: number;
	/** "fewer than 10 empty barrels", "after order 12 is completed". */
	conditions: string[];
	/** [year, year tick] it last finished. */
	finished: [number, number] | null;
}

export interface FortSquadMember {
	/** Index into the squad's positions. */
	position: number;
	leader?: boolean | null;
	hf: number;
	unit: number | null;
	name: string | null;
	/** The uniform's name, e.g. "Melee, metal armor". */
	uniform: string | null;
	assigned_items: number;
	orders: string[];
}

export interface FortSquad {
	id: number;
	name: string | null;
	alias: string | null;
	/** The alert routine it follows, e.g. "Constant training". */
	routine: string | null;
	orders: string[];
	/** Positions in the squad, filled or not. */
	positions: number;
	members: FortSquadMember[];
}

/** An artifact on the map, or made, held or owned by the fortress's people. */
export interface FortArtifact {
	id: number;
	item_id: number;
	name: string | null;
	name_english: string | null;
	description: string;
	/** item_type token. */
	type: string;
	maker_hf: number | null;
	holder_hf: number | null;
	owner_hf: number | null;
	year: number | null;
	tick: number | null;
	site_id: number | null;
	on_map: boolean;
	value: number;
}

/** A historical figure items and artifacts name. */
export interface FortFigure {
	hf: number;
	name: string | null;
	name_english: string | null;
	race: string | null;
	unit_id: number | null;
	alive: boolean;
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
	/** Version 9 on. */
	orders?: RowTable | null;
	squads?: RowTable | null;
	artifacts?: RowTable | null;
	figures?: RowTable | null;
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
 *
 * `veins`, present only on blocks with ore or gem tiles, is run-length
 * encoded the same way: the inorganic index (a key of `minerals`) each
 * MINERAL tile is a vein of, -1 elsewhere.
 */
export type FortMapBlock = [
	z: number,
	bx: number,
	by: number,
	tiles: number[],
	flags: number[],
	veins?: number[],
];

export interface FortTiletype {
	name: string;
	shape: string;
	material: string;
}

/** An inorganic that veins on the map are made of. */
export interface FortMineral {
	/** Raw token, e.g. NATIVE_GOLD. */
	id: string;
	name: string;
	kind: "ore" | "gem" | "mineral";
	/** What it smelts into, e.g. ["lead", "silver"]. */
	metals: string[];
	/** The game's colour for it, e.g. "#ffd700". */
	color?: string | null;
}

export interface FortMapPayload {
	x_count: number;
	y_count: number;
	z_count: number;
	tiletypes: Record<string, FortTiletype>;
	blocks: FortMapBlock[];
	/** Inorganic index -> mineral, for the veins in `blocks`. Version 9 on. */
	minerals?: Record<string, FortMineral>;
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
 * confirmed by the player one at a time. The app runs only the commands in
 * CONSOLE_COMMANDS, each with its arguments checked, because a command that
 * looks harmless can still break a save: a bare `workorder MakeArmor 5`
 * queues armor without saying which, and the game crashes once a dwarf starts
 * the job. Anything else the player can copy into DFHack's console instead.
 */

export const MAX_CONSOLE_COMMAND = 2000;

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

/**
 * Job types a bare `workorder <JobType> <amount>` may queue. The bare form
 * cannot say which item or material to use, so these are the jobs where the
 * workshop picks it: the ones DFHack's own order library and docs queue that
 * way, plus furniture and containers.
 */
export const WORKORDER_JOB_TYPES = [
	"PrepareMeal",
	"MillPlants",
	"ProcessPlants",
	"ProcessPlantsBarrel",
	"MilkCreature",
	"ShearCreature",
	"SpinThread",
	"WeaveCloth",
	"DyeCloth",
	"MakeBarrel",
	"MakeBucket",
	"MakeFlask",
	"MakeGoblet",
	"MakeBackpack",
	"MakeQuiver",
	"MakeCage",
	"MakeTotem",
	"MakeWindow",
	"MakeRawGlass",
	"MakePipeSection",
	"MakeCharcoal",
	"MakeAsh",
	"MakeLye",
	"MakePotashFromAsh",
	"MeltMetalObject",
	"ConstructBed",
	"ConstructTable",
	"ConstructThrone",
	"ConstructDoor",
	"ConstructCabinet",
	"ConstructChest",
	"ConstructCoffin",
	"ConstructBin",
	"ConstructBag",
	"ConstructBlocks",
	"ConstructMechanisms",
	"ConstructArmorStand",
	"ConstructWeaponRack",
	"ConstructStatue",
	"ConstructSlab",
	"ConstructFloodgate",
	"ConstructGrate",
	"ConstructHatchCover",
	"ConstructSplint",
	"ConstructCrutch",
	"CollectSand",
] as const;

/** Job types whose orders must name the exact item (ITEM_ARMOR_BREASTPLATE) and its material. */
export const WORKORDER_NEEDS_ITEM = [
	"MakeAmmo",
	"MakeArmor",
	"MakeGloves",
	"MakeHelm",
	"MakePants",
	"MakeShield",
	"MakeShoes",
	"MakeTool",
	"MakeTrapComponent",
	"MakeWeapon",
] as const;

/** Job types whose orders must name the material: the ore to smelt, the metal to draw. */
const WORKORDER_NEEDS_MATERIAL = ["SmeltOre", "ExtractMetalStrands"];

export const ORDER_LIBRARIES = [
	"basic",
	"furnace",
	"smelting",
	"glassstock",
	"rockstock",
	"military",
] as const;

/** Plugins the app may switch on or off: DFHack's everyday automation. */
export const TOGGLEABLE_PLUGINS = [
	"autobutcher",
	"autochop",
	"autoclothing",
	"autofarm",
	"autonestbox",
	"autoslab",
	"dwarfvet",
	"logistics",
	"nestboxes",
	"preserve-rooms",
	"preserve-tombs",
	"seedwatch",
	"suspendmanager",
	"tailor",
] as const;

const includes = (list: readonly string[], value: unknown): value is string =>
	typeof value === "string" && list.includes(value);

const LIBRARY_HINT =
	"the game's Work orders screen, or orders import library/military (weapons, armor), library/smelting (ores, alloys, steel) or library/basic (drink, food)";

function checkWorkorderJson(text: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return "The work order is not valid JSON";
	}
	for (const order of Array.isArray(parsed) ? parsed : [parsed]) {
		if (!order || typeof order !== "object") return "Each work order must be a JSON object";
		const { job, item_subtype, material, material_category, amount_total } = order as Record<
			string,
			unknown
		>;
		if (amount_total !== undefined && typeof amount_total !== "number")
			return "amount_total must be a number";
		if (includes(WORKORDER_JOB_TYPES, job)) continue;
		const named = typeof material === "string" || Boolean(material_category);
		if (includes(WORKORDER_NEEDS_ITEM, job)) {
			if (typeof item_subtype === "string" && named) continue;
			return `A ${job} order must name the item_subtype and the material, or the game crashes when a dwarf starts it. Use ${LIBRARY_HINT} instead.`;
		}
		if (includes(WORKORDER_NEEDS_MATERIAL, job)) {
			if (typeof material === "string") continue;
			return `A ${job} order must name the material. Use ${LIBRARY_HINT} instead.`;
		}
		return `The app does not queue ${typeof job === "string" ? job : "this job"} orders. Use ${LIBRARY_HINT} instead.`;
	}
	return null;
}

function checkWorkorder(args: string[]): string | null {
	const [first, ...rest] = args;
	if (first === undefined || ["-l", "--listtypes", "-h", "--help"].includes(first)) return null;
	if (first.startsWith("-")) return `The app does not run workorder ${first}`;
	if (first.startsWith("{") || first.startsWith("[")) return checkWorkorderJson(args.join(" "));
	if (includes(WORKORDER_NEEDS_ITEM, first))
		return `"workorder ${first}" cannot say which item to make, and the game crashes on such orders. Use ${LIBRARY_HINT} instead.`;
	if (!includes(WORKORDER_JOB_TYPES, first))
		return `The app does not queue ${first} on its own. Use ${LIBRARY_HINT} instead.`;
	if (rest.length > 1 || (rest.length === 1 && !/^\d{1,5}$/.test(rest[0])))
		return "Write it as workorder <JobType> <amount>";
	return null;
}

function checkOrders(args: string[]): string | null {
	const [sub, target, ...rest] = args;
	if (includes(["list", "sort", "recheck"], sub) && target === undefined) return null;
	const library = target?.match(/^library\/(.+)$/)?.[1];
	if (sub === "import" && !rest.length && includes(ORDER_LIBRARIES, library)) return null;
	return `The app runs orders list, sort, recheck and import library/${ORDER_LIBRARIES.join(", library/")} only`;
}

/** With no plugin named, enable and disable only list what is on. */
function checkToggle(args: string[]): string | null {
	if (args.every((a) => includes(TOGGLEABLE_PLUGINS, a))) return null;
	return `The app switches only these on and off: ${TOGGLEABLE_PLUGINS.join(", ")}`;
}

const anyArgs = () => null;

/** The commands the app runs from the assistant, each with the check for its arguments. */
const CONSOLE_COMMANDS: Record<string, (args: string[]) => string | null> = {
	help: anyArgs,
	ls: anyArgs,
	tags: anyArgs,
	workorder: checkWorkorder,
	orders: checkOrders,
	enable: checkToggle,
	disable: checkToggle,
	autobutcher: anyArgs,
	autochop: anyArgs,
	autoclothing: anyArgs,
	autofarm: anyArgs,
	seedwatch: anyArgs,
	suspendmanager: anyArgs,
	tailor: anyArgs,
	unsuspend: anyArgs,
	combine: anyArgs,
	burial: anyArgs,
	"ban-cooking": anyArgs,
	cleanowned: anyArgs,
};

/** Names of the commands the app runs, for the assistant's instructions. */
export const CONSOLE_COMMAND_NAMES = Object.keys(CONSOLE_COMMANDS);

/** The problem with a console command, or null when it may be queued. */
export function checkConsoleCommand(text: unknown): string | null {
	if (typeof text !== "string") return "The command must be text";
	const trimmed = text.trim();
	if (!trimmed) return "The command is empty";
	if (trimmed.length > MAX_CONSOLE_COMMAND)
		return `The command is longer than ${MAX_CONSOLE_COMMAND} characters`;
	if (/[\r\n]/.test(trimmed)) return "One command per line";
	const [name, ...args] = splitConsoleCommand(trimmed);
	if (!name) return "The command is empty";
	const check = Object.hasOwn(CONSOLE_COMMANDS, name) ? CONSOLE_COMMANDS[name] : undefined;
	if (!check)
		return `The app does not run ${name}. Copy it into DFHack's console yourself if you are sure it is safe.`;
	return check(args);
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
