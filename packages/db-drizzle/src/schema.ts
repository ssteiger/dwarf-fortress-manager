import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	DfhackAction,
	DumpProgress,
	FortAutomation,
	FortDiplomacy,
	FortHealth,
	FortHistoryEvent,
	FortMapPayload,
	FortStatus,
	FortSummary,
	FortUnit,
	FortWorld,
	HistoryFigure,
	LegendsPayload,
	RowTable,
	UnitAction,
} from "./fortress-types";
import type {
	LifeEventData,
	LifeEventKind,
	SnapshotTotals,
	SnapshotUnit,
} from "./snapshots";

export const logs = pgTable("logs", {
	id: serial().primaryKey().notNull(),
	created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow(),
	message: text().notNull(),
});

/** Single row (id = 1): what the worker last saw when it talked to the game. */
export const fort_state = pgTable("fort_state", {
	id: integer().primaryKey().notNull(),
	status: text().$type<FortStatus>().notNull(),
	fort_name: text(),
	world_name: text(),
	game_date: text(),
	captured_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	world: jsonb().$type<FortWorld>(),
	summary: jsonb().$type<FortSummary>(),
	error: text(),
	elapsed_ms: integer(),
});

/** Single row (id = 1): the full dump of the loaded fortress, minus the map. */
export const fort_dump = pgTable("fort_dump", {
	id: integer().primaryKey().notNull(),
	captured_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	/** What the game script wrote; null before this column existed. */
	dump_version: integer(),
	units: jsonb().$type<RowTable>(),
	items: jsonb().$type<RowTable>(),
	buildings: jsonb().$type<RowTable>(),
	jobs: jsonb().$type<RowTable>(),
	announcements: jsonb().$type<RowTable>(),
	orders: jsonb().$type<RowTable>(),
	squads: jsonb().$type<RowTable>(),
	artifacts: jsonb().$type<RowTable>(),
	figures: jsonb().$type<RowTable>(),
	diplomacy: jsonb().$type<FortDiplomacy>(),
	dead: jsonb().$type<RowTable>(),
	automation: jsonb().$type<FortAutomation>(),
	health: jsonb().$type<FortHealth>(),
});

/** Single row (id = 1): the map, dumped on its own slower cadence. */
export const fort_map = pgTable("fort_map", {
	id: integer().primaryKey().notNull(),
	captured_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	x_count: integer().notNull(),
	y_count: integer().notNull(),
	z_count: integer().notNull(),
	tiletypes: jsonb().$type<FortMapPayload["tiletypes"]>().notNull(),
	blocks: jsonb().$type<FortMapPayload["blocks"]>().notNull(),
	minerals: jsonb().$type<NonNullable<FortMapPayload["minerals"]>>(),
});

/**
 * Single row (id = 1): how often the worker reads the game, chosen in
 * Settings, and requests from the app to read it now. The worker answers the
 * requests, leaves a heartbeat while it runs and reports how far each read
 * has got.
 */
export const fort_worker = pgTable("fort_worker", {
	id: integer().primaryKey().notNull(),
	/** Off: the game is only read when someone asks. */
	auto_dump: boolean().notNull().default(true),
	/** Time the game runs freely between the end of one dump and the next. */
	dump_interval_ms: integer().notNull().default(30_000),
	/** Set by the web app to ask for a dump now. */
	dump_requested_at: timestamp({ withTimezone: true, mode: "string" }),
	/** Set by the worker: the latest request its last dump answered. */
	dump_answered_at: timestamp({ withTimezone: true, mode: "string" }),
	/** The worker's heartbeat, every WORKER_HEARTBEAT_MS while it runs. */
	seen_at: timestamp({ withTimezone: true, mode: "string" }),
	/** Set by the worker: where the latest read is. A request clears an ended one. */
	dump_progress: jsonb().$type<DumpProgress>(),
});

/** Append-only chronicle of in-game announcements. */
export const fort_events = pgTable(
	"fort_events",
	{
		id: serial().primaryKey().notNull(),
		dedupe_key: text().notNull(),
		report_id: integer(),
		game_year: integer(),
		game_tick: integer(),
		type: text(),
		text: text().notNull(),
		x: integer(),
		y: integer(),
		z: integer(),
		captured_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("fort_events_dedupe_key_idx").on(t.dedupe_key),
		index("fort_events_game_time_idx").on(t.game_year, t.game_tick),
	],
);

/**
 * The fortress over time: one row per fortress and in-game day, rewritten by
 * each dump that day. Rows dated after the present are dropped when an
 * earlier save is loaded.
 */
export const fort_snapshots = pgTable(
	"fort_snapshots",
	{
		/** "save_dir:site_id", as the chronicle keys the fortress. */
		fort_key: text().notNull(),
		/** gameDay(year, tick): days since the world began. */
		day: integer().notNull(),
		game_year: integer().notNull(),
		game_tick: integer().notNull(),
		captured_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		totals: jsonb().$type<SnapshotTotals>().notNull(),
		units: jsonb().$type<Record<string, SnapshotUnit>>().notNull(),
	},
	(t) => [primaryKey({ columns: [t.fort_key, t.day] })],
);

/** What two snapshots in a row differ by: a citizen's life, one fact at a time. */
export const fort_life_events = pgTable(
	"fort_life_events",
	{
		id: serial().primaryKey().notNull(),
		fort_key: text().notNull(),
		unit_id: integer().notNull(),
		hf: integer(),
		kind: text().$type<LifeEventKind>().notNull(),
		game_year: integer().notNull(),
		game_tick: integer().notNull(),
		data: jsonb().$type<LifeEventData>().notNull(),
		captured_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index("fort_life_events_time_idx").on(t.fort_key, t.game_year, t.game_tick),
		index("fort_life_events_unit_idx").on(t.fort_key, t.unit_id),
	],
);

/**
 * The world's history events at the fortress or naming its people, read live
 * from the game. Events newer than the game holds are dropped when an earlier
 * save is loaded.
 */
export const fort_history_events = pgTable(
	"fort_history_events",
	{
		fort_key: text().notNull(),
		/** The game's own event id, as the legends export numbers it too. */
		event_id: integer().notNull(),
		type: text().notNull(),
		game_year: integer().notNull(),
		game_tick: integer().notNull(),
		here: boolean().notNull(),
		hfids: integer().array().notNull(),
		fields: jsonb().$type<FortHistoryEvent["fields"]>().notNull(),
		extra: jsonb()
			.$type<FortHistoryEvent["extra"] & { figures?: Record<string, HistoryFigure> }>()
			.notNull(),
		captured_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.fort_key, t.event_id] }),
		index("fort_history_events_time_idx").on(t.fort_key, t.game_year, t.game_tick),
		index("fort_history_events_hfids_idx").using("gin", t.hfids),
	],
);

/** How far the worker has read each fortress's history events. */
export const fort_history_cursors = pgTable("fort_history_cursors", {
	fort_key: text().primaryKey().notNull(),
	last_event_id: integer().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
});

/**
 * The last sheet the worker read of a citizen who has since died or left,
 * so their page outlives them.
 */
export const fort_unit_archive = pgTable(
	"fort_unit_archive",
	{
		fort_key: text().notNull(),
		unit_id: integer().notNull(),
		reason: text().$type<"died" | "left">().notNull(),
		/** When they died or left. */
		game_year: integer().notNull(),
		game_tick: integer().notNull(),
		unit: jsonb().$type<FortUnit>().notNull(),
		updated_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [primaryKey({ columns: [t.fort_key, t.unit_id] })],
);

/** Commands queued by the web app and executed by the sole DFHack worker. */
export const fort_commands = pgTable(
	"fort_commands",
	{
		id: serial().primaryKey().notNull(),
		kind: text()
			.$type<"set_nickname" | "dfhack" | "unit_action" | "console">()
			.notNull(),
		/** set_nickname and unit_action: the unit. */
		unit_id: integer(),
		/** set_nickname: the new nickname. */
		nickname: text(),
		/** dfhack: a key of DFHACK_ACTIONS; unit_action: a key of UNIT_ACTIONS. */
		action: text().$type<DfhackAction | UnitAction>(),
		/** unit_action: the text some actions take, such as a title. */
		arg: text(),
		/** console: the exact command the player confirmed. */
		command: text(),
		/** dfhack and console: what the command printed. */
		output: text(),
		status: text()
			.$type<"pending" | "processing" | "done" | "failed">()
			.notNull()
			.default("pending"),
		error: text(),
		created_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		started_at: timestamp({ withTimezone: true, mode: "string" }),
		completed_at: timestamp({ withTimezone: true, mode: "string" }),
	},
	(t) => [
		index("fort_commands_pending_idx").on(t.status, t.created_at),
		index("fort_commands_unit_idx").on(t.unit_id, t.created_at),
	],
);

/** The player's own notes on one unit of one fortress. */
export const fort_unit_notes = pgTable(
	"fort_unit_notes",
	{
		id: serial().primaryKey().notNull(),
		user_id: uuid().notNull(),
		/** "save_dir:site_id", as the chronicle keys the fortress. */
		fort_key: text().notNull(),
		unit_id: integer().notNull(),
		note: text().notNull().default(""),
		created_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updated_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("fort_unit_notes_target_unique").on(
			t.user_id,
			t.fort_key,
			t.unit_id,
		),
	],
);

/** Every nickname given from the nickname page and why; a unit's newest row is theirs. */
export const fort_nicknames = pgTable(
	"fort_nicknames",
	{
		id: serial().primaryKey().notNull(),
		user_id: uuid().notNull(),
		/** "save_dir:site_id", as the chronicle keys the fortress. */
		fort_key: text().notNull(),
		unit_id: integer().notNull(),
		nickname: text().notNull(),
		/** The fact behind the name; null when the player typed their own. */
		why: text(),
		source: text()
			.$type<"facts" | "model" | "list" | "typed">()
			.notNull()
			.default("typed"),
		created_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index("fort_nicknames_unit_idx").on(t.fort_key, t.unit_id, t.created_at),
	],
);

/** The player's own nicknames waiting for a dwarf to fit them, across fortresses. */
export const nickname_list = pgTable(
	"nickname_list",
	{
		id: serial().primaryKey().notNull(),
		user_id: uuid().notNull(),
		name: text().notNull(),
		created_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("nickname_list_name_unique").on(
			t.user_id,
			sql`lower(${t.name})`,
		),
	],
);

/** One row per exported world (grouped by the legends file prefix). */
export const legends_worlds = pgTable("legends_worlds", {
	id: serial().primaryKey().notNull(),
	key: text().notNull().unique(),
	name: text(),
	alt_name: text(),
	imported_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	record_counts: jsonb().$type<Record<string, number>>(),
});

/** Files already imported, so the worker can skip them on restart. */
export const legends_imports = pgTable("legends_imports", {
	id: serial().primaryKey().notNull(),
	world_id: integer()
		.notNull()
		.references(() => legends_worlds.id, { onDelete: "cascade" }),
	path: text().notNull().unique(),
	size: bigint({ mode: "number" }).notNull(),
	mtime_ms: bigint({ mode: "number" }).notNull(),
	records: integer().notNull().default(0),
	imported_at: timestamp({ withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
});

/**
 * Every legends element, generic. `payload` is the vanilla legends.xml element
 * as JSON, with the legends_plus.xml element merged under `payload.plus`.
 */
export const legends_records = pgTable(
	"legends_records",
	{
		world_id: integer()
			.notNull()
			.references(() => legends_worlds.id, { onDelete: "cascade" }),
		kind: text().notNull(),
		id: integer().notNull(),
		name: text(),
		type: text(),
		year: integer(),
		hfids: integer().array(),
		entity_ids: integer().array(),
		site_ids: integer().array(),
		artifact_ids: integer().array(),
		payload: jsonb().$type<LegendsPayload>().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.world_id, t.kind, t.id] }),
		index("legends_records_kind_year_idx").on(t.world_id, t.kind, t.year),
		index("legends_records_name_idx").on(t.world_id, t.name),
		index("legends_records_hfids_idx").using("gin", t.hfids),
		index("legends_records_entity_ids_idx").using("gin", t.entity_ids),
		index("legends_records_site_ids_idx").using("gin", t.site_ids),
		index("legends_records_artifact_ids_idx").using("gin", t.artifact_ids),
	],
);

/**
 * A reader's journal for legends mode: pins and notes on records, events,
 * spans of years and stories, per user and per world. `target_id` is text so
 * one table holds record ids, "from-to" spans and story keys alike.
 */
export const legends_notes = pgTable(
	"legends_notes",
	{
		id: serial().primaryKey().notNull(),
		user_id: uuid().notNull(),
		world_id: integer()
			.notNull()
			.references(() => legends_worlds.id, { onDelete: "cascade" }),
		target_kind: text().notNull(),
		target_id: text().notNull(),
		title: text().notNull().default(""),
		note: text().notNull().default(""),
		tags: text().array().notNull().default([]),
		created_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updated_at: timestamp({ withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("legends_notes_target_unique").on(
			t.user_id,
			t.world_id,
			t.target_kind,
			t.target_id,
		),
		index("legends_notes_user_world_idx").on(
			t.user_id,
			t.world_id,
			t.updated_at,
		),
	],
);
