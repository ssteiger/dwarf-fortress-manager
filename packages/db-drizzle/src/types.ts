import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import * as schema from "./schema";

export { schema };

export { and, asc, desc, eq, like, not, or } from "drizzle-orm";

export * from "./fortress-types";
export * from "./snapshots";

export type Log = InferSelectModel<typeof schema.logs>;
export type NewLog = InferInsertModel<typeof schema.logs>;

export type FortState = InferSelectModel<typeof schema.fort_state>;
export type NewFortState = InferInsertModel<typeof schema.fort_state>;
export type FortDump = InferSelectModel<typeof schema.fort_dump>;
export type NewFortDump = InferInsertModel<typeof schema.fort_dump>;
export type FortMap = InferSelectModel<typeof schema.fort_map>;
export type FortWorker = InferSelectModel<typeof schema.fort_worker>;
export type FortEvent = InferSelectModel<typeof schema.fort_events>;
export type NewFortEvent = InferInsertModel<typeof schema.fort_events>;
export type FortSnapshotRow = InferSelectModel<typeof schema.fort_snapshots>;
export type FortLifeEvent = InferSelectModel<typeof schema.fort_life_events>;
export type FortArchivedUnit = InferSelectModel<typeof schema.fort_unit_archive>;
export type FortHistoryRow = InferSelectModel<typeof schema.fort_history_events>;
export type FortCommand = InferSelectModel<typeof schema.fort_commands>;
export type NewFortCommand = InferInsertModel<typeof schema.fort_commands>;
export type FortUnitNote = InferSelectModel<typeof schema.fort_unit_notes>;
export type FortNickname = InferSelectModel<typeof schema.fort_nicknames>;
export type NicknameListEntry = InferSelectModel<typeof schema.nickname_list>;

export type LegendsWorld = InferSelectModel<typeof schema.legends_worlds>;
export type LegendsImport = InferSelectModel<typeof schema.legends_imports>;
export type LegendsRecord = InferSelectModel<typeof schema.legends_records>;
export type NewLegendsRecord = InferInsertModel<typeof schema.legends_records>;
export type LegendsNote = InferSelectModel<typeof schema.legends_notes>;
