import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import * as schema from "./schema";

export { schema };

export { and, asc, desc, eq, like, not, or } from "drizzle-orm";

export * from "./fortress-types";

export type Log = InferSelectModel<typeof schema.logs>;
export type NewLog = InferInsertModel<typeof schema.logs>;

export type FortState = InferSelectModel<typeof schema.fort_state>;
export type NewFortState = InferInsertModel<typeof schema.fort_state>;
export type FortDump = InferSelectModel<typeof schema.fort_dump>;
export type NewFortDump = InferInsertModel<typeof schema.fort_dump>;
export type FortMap = InferSelectModel<typeof schema.fort_map>;
export type FortEvent = InferSelectModel<typeof schema.fort_events>;
export type NewFortEvent = InferInsertModel<typeof schema.fort_events>;

export type LegendsWorld = InferSelectModel<typeof schema.legends_worlds>;
export type LegendsImport = InferSelectModel<typeof schema.legends_imports>;
export type LegendsRecord = InferSelectModel<typeof schema.legends_records>;
export type NewLegendsRecord = InferInsertModel<typeof schema.legends_records>;
