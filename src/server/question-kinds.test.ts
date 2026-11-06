// Owns: tests for grading each question kind and for checking a teacher's question input. Not here: quiz operations against the database (src/server/quizzes.test.ts).

import { type } from "arktype";
import { describe, expect, it } from "vitest";
import { QUESTION_KINDS } from "#/server/question-kinds";
import { QuestionInput } from "#/server/quizzes";

const grade = (kind: keyof typeof QUESTION_KINDS, key: unknown, answer: unknown) =>
	QUESTION_KINDS[kind].grade(key, answer)?.correct;

const choices = [
	{ id: "a", text: "1 N" },
	{ id: "b", text: "2 N" },
	{ id: "c", text: "3 N" },
];

describe("grading", () => {
	it("single choice is right only for the exact choice id", () => {
		expect(grade("single_choice", "b", "b")).toBe(true);
		expect(grade("single_choice", "b", "a")).toBe(false);
		expect(grade("single_choice", "b", "B")).toBe(false);
	});

	it("multiple choice needs exactly the right set, with no partial credit", () => {
		expect(grade("multiple_choice", ["a", "c"], ["c", "a"])).toBe(true);
		expect(grade("multiple_choice", ["a", "c"], ["a", "a", "c"])).toBe(true);
		expect(grade("multiple_choice", ["a", "c"], ["a"])).toBe(false);
		expect(grade("multiple_choice", ["a", "c"], ["a", "b", "c"])).toBe(false);
		expect(grade("multiple_choice", ["a", "c"], [])).toBe(false);
	});

	it("number is right within the absolute tolerance, edges included", () => {
		const key = { value: 9.8, tolerance: 0.1 };
		expect(grade("number", key, 9.8)).toBe(true);
		// Exactly on each edge. Plain floating-point subtraction puts 9.9 just outside.
		expect(grade("number", key, 9.9)).toBe(true);
		expect(grade("number", key, 9.7)).toBe(true);
		expect(grade("number", key, 9.9001)).toBe(false);
		expect(grade("number", key, 9.6999)).toBe(false);
		expect(grade("number", { value: -3, tolerance: 0.5 }, -3.5)).toBe(true);
		expect(grade("number", { value: -3, tolerance: 0.5 }, -2.4)).toBe(false);
	});

	it("number with no tolerance still accepts the same value reached by arithmetic", () => {
		expect(grade("number", { value: 0.3, tolerance: 0 }, 0.1 + 0.2)).toBe(true);
		expect(grade("number", { value: 0.3, tolerance: 0 }, 0.31)).toBe(false);
		expect(grade("number", { value: 1_000_000, tolerance: 0 }, 1_000_000.01)).toBe(false);
		expect(grade("number", { value: 2e9, tolerance: 0 }, 2e9 + 1)).toBe(false);
		expect(grade("number", { value: 2e9, tolerance: 0 }, 2e9)).toBe(true);
	});

	it("short text ignores case, outer spaces, and repeated inner whitespace, but nothing else", () => {
		const key = "Gaya Gravitasi";
		expect(grade("short_text", key, "Gaya Gravitasi")).toBe(true);
		expect(grade("short_text", key, "  gaya   GRAVITASI ")).toBe(true);
		expect(grade("short_text", key, "gaya\tgravitasi\n")).toBe(true);
		expect(grade("short_text", key, "gayagravitasi")).toBe(false);
		expect(grade("short_text", key, "gaya gravitasi.")).toBe(false);
	});

	it("an answer of the wrong shape is not graded at all", () => {
		expect(QUESTION_KINDS.single_choice.grade("a", 1)).toBeUndefined();
		expect(QUESTION_KINDS.multiple_choice.grade(["a"], "a")).toBeUndefined();
		expect(QUESTION_KINDS.number.grade({ value: 1, tolerance: 0 }, "1")).toBeUndefined();
		expect(QUESTION_KINDS.short_text.grade("ya", ["ya"])).toBeUndefined();
	});
});

const valid = (input: object) => QuestionInput.assert(input);
const invalid = (input: object) => expect(QuestionInput(input)).toBeInstanceOf(type.errors);

describe("question input", () => {
	it("splits a question into what students see and its key", () => {
		expect(
			valid({ kind: "single_choice", prompt: "Berapa?", choices, correct: "b", extra: 1 }),
		).toEqual({
			kind: "single_choice",
			prompt: "Berapa?",
			choices,
			key: { correct: "b", feedback: "", solution: "" },
		});
		expect(valid({ kind: "number", prompt: "g?", correct: { value: 9.8 } })).toMatchObject({
			choices: null,
			key: { correct: { value: 9.8, tolerance: 0 } },
		});
		// null is how teacherQuiz says "no choices", so the editor can send a question straight back.
		expect(valid({ kind: "short_text", prompt: "p", choices: null, correct: "ya" })).toMatchObject({
			choices: null,
		});
	});

	it("refuses keys that don't fit the question", () => {
		invalid({ kind: "single_choice", prompt: "p", choices, correct: "z" });
		invalid({ kind: "single_choice", prompt: "p", choices, correct: ["a"] });
		invalid({ kind: "multiple_choice", prompt: "p", choices, correct: ["a", "z"] });
		invalid({ kind: "multiple_choice", prompt: "p", choices, correct: [] });
		invalid({ kind: "multiple_choice", prompt: "p", choices, correct: ["a", "a"] });
		invalid({ kind: "number", prompt: "p", correct: { value: 1, tolerance: -0.1 } });
		invalid({ kind: "number", prompt: "p", correct: 1 });
		invalid({ kind: "short_text", prompt: "p", correct: "   " });
	});

	it("refuses bad choices, and choices on kinds that have none", () => {
		invalid({ kind: "single_choice", prompt: "p", choices: [choices[0]], correct: "a" });
		invalid({
			kind: "single_choice",
			prompt: "p",
			choices: [...choices, { id: "a", text: "lagi" }],
			correct: "a",
		});
		invalid({ kind: "single_choice", prompt: "p", correct: "a" });
		invalid({ kind: "number", prompt: "p", choices, correct: { value: 1 } });
		invalid({ kind: "essay", prompt: "p", correct: "x" });
		invalid({ kind: "short_text", prompt: "", correct: "x" });
	});
});
