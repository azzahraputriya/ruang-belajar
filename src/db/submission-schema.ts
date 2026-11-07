// Owns: the submission, submission_file, and submission_event tables, meaning what a student handed in on an assignment or reflection and what happened to it. Not here: the lifecycle rules (src/server/submission-lifecycle.ts) or reading and writing them (src/server/submissions.ts).

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
import type { StepId, StorageKey, SubmissionFileId, SubmissionId, UserId } from "#/db/ids";

export const submissionStatus = pgEnum("submission_status", [
	"draft",
	"submitted",
	"returned",
	"graded",
]);
export type SubmissionStatus = (typeof submissionStatus.enumValues)[number];

export const submissionAction = pgEnum("submission_action", ["submit", "return", "grade"]);
export type SubmissionAction = (typeof submissionAction.enumValues)[number];

// One current submission per student per step. A return and resubmit edit this row, and
// submission_event keeps what happened along the way.
export const submission = pgTable(
	"submission",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<SubmissionId>(),
		stepId: uuid("step_id")
			.notNull()
			.references(() => step.id, { onDelete: "cascade" })
			.$type<StepId>(),
		studentId: text("student_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UserId>(),
		status: submissionStatus("status").notNull().default("draft"),
		text: text("text").notNull().default(""),
		// The first submit. A resubmit after a return keeps it, so lateness is judged on when the
		// student first handed in, not on when the teacher asked for changes.
		submittedAt: timestamp("submitted_at"),
		returnedAt: timestamp("returned_at"),
		gradedAt: timestamp("graded_at"),
		// The teacher's latest comment, from a return or a grade.
		comment: text("comment"),
		score: integer("score"),
		// Points per rubric criterion id, when the step has a rubric. Every read parses it.
		rubricScores: jsonb("rubric_scores"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("submission_step_student_idx").on(t.stepId, t.studentId),
		// Deleting a user cascades here by student_id.
		index("submission_student_id_idx").on(t.studentId),
	],
);

export const submissionFile = pgTable(
	"submission_file",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<SubmissionFileId>(),
		submissionId: uuid("submission_id")
			.notNull()
			.references(() => submission.id, { onDelete: "cascade" })
			.$type<SubmissionId>(),
		storageKey: uuid("storage_key").notNull().unique().$type<StorageKey>(),
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		size: integer("size").notNull(),
		uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
	},
	(t) => [index("submission_file_submission_id_idx").on(t.submissionId)],
);

// One row per lifecycle move that changed something, so "returned with comment X, then
// resubmitted" stays visible after the row moves on.
export const submissionEvent = pgTable(
	"submission_event",
	{
		// A counter, not a uuid: it orders the history even when two moves share a millisecond.
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		submissionId: uuid("submission_id")
			.notNull()
			.references(() => submission.id, { onDelete: "cascade" })
			.$type<SubmissionId>(),
		action: submissionAction("action").notNull(),
		comment: text("comment"),
		score: integer("score"),
		at: timestamp("at").defaultNow().notNull(),
	},
	(t) => [index("submission_event_submission_id_idx").on(t.submissionId)],
);
