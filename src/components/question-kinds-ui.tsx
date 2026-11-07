// Owns: how each question kind looks to a student, meaning its labels, the answer control, turning an in-progress answer into what the server takes, and writing answers and keys as text. Not here: each kind's stored shape and grading (src/server/question-kinds.ts) or the teacher's key editor (src/components/quiz-editor.tsx).

import { Check, Minus, X } from "lucide-react";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import type { QuestionId } from "#/db/ids";
import type { QuestionKind } from "#/db/quiz-schema";
import { formatDecimal, parseDecimal } from "#/lib/decimal";
import type { QuizQuestion } from "#/server/quiz-fns";

// AKM terms: "pilihan ganda" has one answer, "pilihan ganda kompleks" several.
export const QUESTION_KIND_UI: { [K in QuestionKind]: { label: string; short: string } } = {
	single_choice: { label: "Pilihan ganda", short: "PG" },
	multiple_choice: { label: "Pilihan ganda kompleks", short: "PGK" },
	number: { label: "Angka", short: "Angka" },
	short_text: { label: "Isian singkat", short: "Isian" },
};

export const QUESTION_KIND_LIST = Object.keys(QUESTION_KIND_UI).filter((k): k is QuestionKind =>
	Object.hasOwn(QUESTION_KIND_UI, k),
);

// What a student has picked or typed so far. A number stays text, so "19,6" shows as typed.
export type DraftAnswer = string | readonly string[];
export type DraftAnswers = Partial<Record<QuestionId, DraftAnswer>>;

// The answers the server stores: a choice id, several, a number, or a text.
type Answer = string | readonly string[] | number;
type Choice = NonNullable<QuizQuestion["choices"]>[number];

export const letter = (index: number) => String.fromCodePoint(65 + index);

export function isAnswered(draft: DraftAnswer | undefined) {
	if (draft === undefined) return false;
	return typeof draft === "string" ? draft.trim() !== "" : draft.length > 0;
}

// The answers to send, leaving out unanswered questions (they count as wrong). `invalid` is the first
// number answer that can't be read, which the screen sends the student back to instead of sending.
export function collectAnswers(questions: readonly QuizQuestion[], drafts: DraftAnswers) {
	const answers: Record<string, string | string[] | number> = {};
	let unanswered = 0;
	for (const [index, q] of questions.entries()) {
		const draft = drafts[q.id];
		if (!isAnswered(draft)) {
			unanswered += 1;
			continue;
		}
		if (typeof draft !== "string") answers[q.id] = [...(draft ?? [])];
		else if (q.kind !== "number") answers[q.id] = draft;
		else {
			const value = parseDecimal(draft);
			if (value === undefined) return { invalid: index } as const;
			answers[q.id] = value;
		}
	}
	return { answers, unanswered } as const;
}

// A number answer that has text but can't be read. Shown once the student tries to send.
export const numberError = (q: QuizQuestion, draft: DraftAnswer | undefined) =>
	q.kind === "number" &&
	typeof draft === "string" &&
	isAnswered(draft) &&
	parseDecimal(draft) === undefined
		? "Isi angka, mis. 19,6."
		: undefined;

const CHOICE_ROW =
	"flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted has-[[data-state=checked]]:bg-primary/5";

// One question's answer control, by kind.
export function AnswerInput({
	q,
	value,
	onChange,
	error,
}: {
	q: QuizQuestion;
	value: DraftAnswer | undefined;
	onChange: (next: DraftAnswer) => void;
	error?: string;
}) {
	const choices = q.choices ?? [];
	if (q.kind === "single_choice") {
		return (
			<RadioGroup
				aria-label="Jawaban"
				value={typeof value === "string" ? value : ""}
				onValueChange={onChange}
				className="gap-1.5"
			>
				{choices.map((c, i) => (
					<label key={c.id} className={CHOICE_ROW}>
						<RadioGroupItem value={c.id} />
						<span className="w-4 text-muted-foreground">{letter(i)}</span>
						{c.text}
					</label>
				))}
			</RadioGroup>
		);
	}
	if (q.kind === "multiple_choice") {
		const picked = new Set(Array.isArray(value) ? value : []);
		return (
			<fieldset className="grid gap-1.5">
				<legend className="sr-only">Jawaban</legend>
				{choices.map((c, i) => (
					<label key={c.id} className={CHOICE_ROW}>
						<Checkbox
							checked={picked.has(c.id)}
							onCheckedChange={(on) =>
								// Kept in choice order, so the answer reads the same however it was clicked.
								onChange(
									choices
										.filter((x) => (x.id === c.id ? on === true : picked.has(x.id)))
										.map((x) => x.id),
								)
							}
						/>
						<span className="w-4 text-muted-foreground">{letter(i)}</span>
						{c.text}
					</label>
				))}
			</fieldset>
		);
	}
	const number = q.kind === "number";
	return (
		<div className="grid gap-1.5">
			<Input
				aria-label="Jawaban"
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? `answer-${q.id}-error` : undefined}
				value={typeof value === "string" ? value : ""}
				onChange={(e) => onChange(e.target.value)}
				inputMode={number ? "decimal" : "text"}
				autoComplete="off"
				maxLength={200}
				placeholder={number ? "Angka, mis. 12,5" : "Jawaban"}
				className={number ? "max-w-40 tabular-nums" : "max-w-xs"}
			/>
			{error ? (
				<p id={`answer-${q.id}-error`} className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

// Choices named by text, in the question's order. A choice the teacher removed since shows as "?".
function choiceTexts(choices: readonly Choice[], ids: readonly string[]) {
	const known = choices.filter((c) => ids.includes(c.id)).map((c) => c.text);
	const missing = ids.filter((id) => !choices.some((c) => c.id === id)).map(() => "?");
	return [...known, ...missing].join(", ");
}

// A stored answer as the student reads it back.
export function answerText(q: QuizQuestion, answer: Answer | undefined) {
	if (answer === undefined) return "kosong";
	if (typeof answer === "number") return formatDecimal(answer);
	if (q.choices === null) return typeof answer === "string" ? answer : answer.join(", ");
	const ids = typeof answer === "string" ? [answer] : answer;
	return ids.length === 0 ? "kosong" : choiceTexts(q.choices, ids);
}

// An answer key as text. Choices by letter for the teacher's list, by text for a student's reveal.
export function keyText(
	q: Pick<QuizQuestion, "choices">,
	correct: string | readonly string[] | { value: number; tolerance: number },
	choicesBy: "letter" | "text",
) {
	if (typeof correct === "object" && !Array.isArray(correct) && "value" in correct) {
		const value = formatDecimal(correct.value);
		return correct.tolerance ? `${value} ± ${formatDecimal(correct.tolerance)}` : value;
	}
	if (q.choices === null) return typeof correct === "string" ? correct : correct.join(", ");
	const ids = typeof correct === "string" ? [correct] : correct;
	if (choicesBy === "text") return choiceTexts(q.choices, ids);
	return q.choices.flatMap((c, i) => (ids.includes(c.id) ? [letter(i)] : [])).join(", ");
}

// Right, wrong, or unknown (an attempt stored before results were kept, or a question added since).
export function Mark({ correct }: { correct: boolean | undefined }) {
	if (correct === undefined) {
		return (
			<span className="mt-0.5 inline-flex size-4 shrink-0 text-muted-foreground">
				<Minus className="size-full" />
				<span className="sr-only">Tidak diketahui</span>
			</span>
		);
	}
	const Icon = correct ? Check : X;
	return (
		<span
			className={`mt-0.5 inline-flex size-4 shrink-0 ${correct ? "text-primary" : "text-destructive"}`}
		>
			<Icon className="size-full" strokeWidth={3} />
			<span className="sr-only">{correct ? "Benar" : "Salah"}</span>
		</span>
	);
}
