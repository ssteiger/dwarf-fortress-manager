import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
	FortMapPayload,
	FortStatus,
	FortSummary,
	FortWorld,
	LegendsPayload,
	RowTable,
} from "./fortress-types";

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
	units: jsonb().$type<RowTable>(),
	items: jsonb().$type<RowTable>(),
	buildings: jsonb().$type<RowTable>(),
	jobs: jsonb().$type<RowTable>(),
	announcements: jsonb().$type<RowTable>(),
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
