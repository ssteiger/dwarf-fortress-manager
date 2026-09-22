/**
 * Shapes shared by the DFHack worker (writer) and the web app (reader).
 *
 * The worker's Lua script emits every collection in row form
 * (`columns` + `rows`) to keep the JSON small. `decodeTable` turns that back
 * into objects keyed by column name.
 */

export type FortStatus = "live" | "menu" | "offline";

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

export interface FortUnit {
	id: number;
	name: string;
	name_english: string;
	readable: string;
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
