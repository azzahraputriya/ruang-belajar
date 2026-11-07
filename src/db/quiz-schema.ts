// Owns: the question and quiz_attempt tables, meaning what students may see of a quiz and what they handed in. Not here: answer keys (src/db/question-key-schema.ts) or the quiz rules (src/server/quizzes.ts).

import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "#/db/auth-schema.gen";
import { step } from "#/db/content-schema";
import type { QuestionId, StepId, UserId } from "#/db/ids";

// Adding a kind is one value here (a migration) plus its entry in src/server/question-kinds.ts.
export const questionKind = pgEnum("question_kind", [
	"single_choice",
	"multiple_choice",
	"number",
	"short_text",
]);
export type QuestionKind = (typeof questionKind.enumValues)[number];

// Positions are dense, 0 to n-1, within a quiz step, like steps in a module.
export const question = pgTable(
	"question",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<QuestionId>(),
		stepId: uuid("step_id")
			.notNull()
			.references(() => step.id, { onDelete: "cascade" })
			.$type<StepId>(),
		position: integer("position").notNull(),
		kind: questionKind("kind").notNull(),
		prompt: text("prompt").notNull(),
		// The choices a student picks from. Null for kinds without choices. Every read parses it.
		choices: jsonb("choices"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("question_step_id_idx").on(t.stepId)],
);

// One row per submitted attempt. The unique index is the backstop for the lock in submitAttempt.
export const quizAttempt = pgTable(
	"quiz_attempt",
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
		attemptNumber: integer("attempt_number").notNull(),
		// The parsed answers, keyed by question id.
		answers: jsonb("answers").notNull(),
		// Whether each question was right when graded, keyed by question id. Stored, not recomputed, so a
		// later edit to a question never changes a past result. Attempts from before this column hold {},
		// which the screens read as "unknown", not wrong.
		results: jsonb("results").notNull().default({}),
		// Percent of questions correct, rounded down. With a whole-number pass score, rounding down
		// never changes whether an attempt passes.
		score: integer("score").notNull(),
		submittedAt: timestamp("submitted_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("quiz_attempt_step_student_number_idx").on(t.stepId, t.studentId, t.attemptNumber),
		// Deleting a user cascades here by student_id.
		index("quiz_attempt_student_id_idx").on(t.studentId),
	],
);
