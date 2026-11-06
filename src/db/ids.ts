// Owns: branded ID types and their parsers, so a class id can't be passed where a user id belongs. Not here: table definitions (src/db/class-schema.ts).

import { type } from "arktype";

export const ClassId = type("string.uuid").brand("ClassId");
export type ClassId = typeof ClassId.infer;

export const InviteId = type("string.uuid").brand("InviteId");
export type InviteId = typeof InviteId.infer;

export const ModuleId = type("string.uuid").brand("ModuleId");
export type ModuleId = typeof ModuleId.infer;

export const StepId = type("string.uuid").brand("StepId");
export type StepId = typeof StepId.infer;

// better-auth makes its own ids, which are not uuids.
export const UserId = type("string > 0").brand("UserId");
export type UserId = typeof UserId.infer;
