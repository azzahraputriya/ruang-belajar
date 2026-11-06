// Owns: the question kind registry, meaning each kind's choices, answer key shape, student answer shape, and grading rule, all pure. Not here: the tables (src/db/quiz-schema.ts, src/db/question-key-schema.ts) or reading and writing questions (src/server/quizzes.ts).

import { type ArkErrors, type } from "arktype";
import type { QuestionKind } from "#/db/quiz-schema";

const ChoiceIdShape = type("1 <= string <= 20");
const Choices = type({ "+": "delete", id: ChoiceIdShape, text: "1 <= string <= 2000" })
	.array()
	.atLeastLength(2)
	.atMostLength(10)
	.narrow(
		(choices, ctx) =>
			new Set(choices.map((c) => c.id)).size === choices.length || ctx.mustBe("unique choice ids"),
	);
export type Choice = (typeof Choices.infer)[number];

// How short answers are compared: Unicode-normalized, trimmed, inner whitespace collapsed, case-folded.
export const normalizeText = (text: string) =>
	text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

// Floating-point slack for number answers, so 9.9 counts for 9.8 ± 0.1 (9.9 - 9.8 is 0.10000000000000142).
const numberSlack = (value: number) => 1e-9 * Math.max(1, Math.abs(value));

// An ArkType type, seen as a function. Typing it this way makes TypeScript infer the parsed output.
type Parse<T> = (raw: unknown) => T | ArkErrors;

type QuestionKindSpec<K, A> = {
	choices: boolean;
	key: Parse<K>;
	answer: Parse<A>;
	// Whether the key only names choices that exist. Kinds without choices accept every key.
	keyFits?: (key: K, choiceIds: ReadonlySet<string>) => boolean;
	grade: (key: K, answer: A) => boolean;
};

// Wraps one kind so callers can parse and grade with unknown input and get one uniform type back.
// The generic ties each kind's key to its own answer, so no cast is needed anywhere.
function questionKind<K, A>(spec: QuestionKindSpec<K, A>) {
	// Keys in the database were checked on the way in, so a bad one is a bug, not bad input.
	const readKey = (stored: unknown) => {
		const key = spec.key(stored);
		if (key instanceof type.errors) throw new Error(`Stored answer key is invalid: ${key.summary}`);
		return key;
	};
	return {
		choices: spec.choices,
		readKey,
		// Checks a teacher's key against the kind and the question's choices. A string is the reason it was refused.
		parseKey(raw: unknown, choiceIds: ReadonlySet<string>) {
			const key = spec.key(raw);
			if (key instanceof type.errors) return key.summary;
			if (spec.keyFits && !spec.keyFits(key, choiceIds))
				return "the key names a choice that doesn't exist";
			return { key };
		},
		// Parses a student's answer and grades it against a stored key. Undefined when the answer has the wrong shape.
		grade(storedKey: unknown, raw: unknown) {
			const answer = spec.answer(raw);
			if (answer instanceof type.errors) return undefined;
			return { answer, correct: spec.grade(readKey(storedKey), answer) };
		},
	};
}

export const QUESTION_KINDS = {
	single_choice: questionKind({
		choices: true,
		key: ChoiceIdShape,
		answer: ChoiceIdShape,
		keyFits: (key, ids) => ids.has(key),
		grade: (key, answer) => key === answer,
	}),
	// Exact set match, no partial credit: a half-right selection is wrong, like a wrong single choice.
	multiple_choice: questionKind({
		choices: true,
		key: ChoiceIdShape.array()
			.atLeastLength(1)
			.narrow((ids, ctx) => new Set(ids).size === ids.length || ctx.mustBe("unique choice ids")),
		answer: ChoiceIdShape.array().atMostLength(10),
		keyFits: (key, ids) => key.every((id) => ids.has(id)),
		grade: (key, answer) => {
			const picked = new Set(answer);
			return picked.size === key.length && key.every((id) => picked.has(id));
		},
	}),
	// The tolerance is absolute, in the same unit as the value.
	number: questionKind({
		choices: false,
		key: type({ "+": "delete", value: "number", tolerance: ["number >= 0", "=", 0] }),
		answer: type("number"),
		grade: ({ value, tolerance }, answer) =>
			Math.abs(answer - value) <= tolerance + numberSlack(value),
	}),
	short_text: questionKind({
		choices: false,
		key: type("string <= 200").narrow(
			(text, ctx) => normalizeText(text) !== "" || ctx.mustBe("a non-empty answer"),
		),
		answer: type("string <= 200"),
		grade: (key, answer) => normalizeText(key) === normalizeText(answer),
	}),
} as const satisfies Record<QuestionKind, unknown>;

export const parseChoices = (raw: unknown) => Choices(raw);

// A stored attempt's answers, keyed by question id: every value is one of the answer shapes above.
export const StoredAnswers = type("Record<string, string | string[] | number>");
