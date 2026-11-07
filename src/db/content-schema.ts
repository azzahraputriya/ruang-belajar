// Owns: the module, step, and step_visit tables. Not here: the shape of each step kind's content (src/server/step-kinds.ts) or the rules for changing them (src/server/modules.ts).

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "#/db/auth-schema.gen";
import { classTable } from "#/db/class-schema";
import type { ClassId, ModuleId, StepId, UserId } from "#/db/ids";

// Adding a kind is one value here (a migration) plus its entry in src/server/step-kinds.ts, which won't compile without it.
export const stepKind = pgEnum("step_kind", ["reading", "embed", "quiz"]);
export type StepKind = (typeof stepKind.enumValues)[number];

export const visitEvent = pgEnum("visit_event", ["opened", "finished"]);
export type VisitEvent = (typeof visitEvent.enumValues)[number];

// Positions are dense, 0 to n-1, within a class (modules) or a module (steps).
// No unique index on them: Postgres checks one row at a time, so a reorder would collide halfway through.
// The class or module row lock keeps writers from interleaving instead.
export const moduleTable = pgTable(
	"module",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<ModuleId>(),
		classId: uuid("class_id")
			.notNull()
			.references(() => classTable.id, { onDelete: "cascade" })
			.$type<ClassId>(),
		title: text("title").notNull(),
		position: integer("position").notNull(),
		opensAt: timestamp("opens_at"),
		dueAt: timestamp("due_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("module_class_id_idx").on(t.classId)],
);

export const step = pgTable(
	"step",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<StepId>(),
		moduleId: uuid("module_id")
			.notNull()
			.references(() => moduleTable.id, { onDelete: "cascade" })
			.$type<ModuleId>(),
		position: integer("position").notNull(),
		kind: stepKind("kind").notNull(),
		title: text("title").notNull(),
		// Left as unknown on purpose: every read parses it with the kind's ArkType shape.
		content: jsonb("content").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("step_module_id_idx").on(t.moduleId)],
);

// One row per thing that happened. Repeats are kept, status reads them as a set.
export const stepVisit = pgTable(
	"step_visit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		stepId: uuid("step_id")
			.notNull()
			.references(() => step.id, { onDelete: "cascade" })
			.$type<StepId>(),
		studentId: text("student_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UserId>(),
		event: visitEvent("event").notNull(),
		at: timestamp("at").defaultNow().notNull(),
	},
	(t) => [
		index("step_visit_step_student_idx").on(t.stepId, t.studentId),
		// Deleting a user cascades here by student_id.
		index("step_visit_student_id_idx").on(t.studentId),
	],
);
