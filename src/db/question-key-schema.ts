// Owns: the question_key table, the correct answer, feedback, and solution for each question. Not here: anything a student may see (src/db/quiz-schema.ts).
// Only the files the lint rule `ruang/question-key-server-only` allows may import this. It is kept
// out of src/db/schema.ts on purpose, so the shared `db` client doesn't carry it either.

import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { QuestionId } from "#/db/ids";
import { question } from "#/db/quiz-schema";

export const questionKey = pgTable("question_key", {
	questionId: uuid("question_id")
		.primaryKey()
		.references(() => question.id, { onDelete: "cascade" })
		.$type<QuestionId>(),
	// Shaped by the question's kind. Every read parses it with src/server/question-kinds.ts.
	correct: jsonb("correct").notNull(),
	feedback: text("feedback").notNull(),
	solution: text("solution").notNull(),
});
