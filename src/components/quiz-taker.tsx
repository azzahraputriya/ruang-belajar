// Owns: the student's quiz screens inside the step pane (taking it one question at a time, the result list, and "perlu bantuan" once attempts run out), plus the taking view the teacher's Pratinjau reuses. Not here: each kind's answer control and text (src/components/question-kinds-ui.tsx), the step header (src/components/step-reader.tsx), or quiz rules (src/server/quizzes.ts).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import {
	AnswerInput,
	type DraftAnswers,
	Mark,
	QUESTION_KIND_UI,
	answerText,
	collectAnswers,
	isAnswered,
	keyText,
	numberError,
} from "#/components/question-kinds-ui";
import { Markdown } from "#/components/step-kinds-ui";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import type { ClassId, StepId } from "#/db/ids";
import { refusalMessage } from "#/lib/refused";
import { orThrow } from "#/server/module-fns";
import {
	type QuizAttempt,
	type QuizQuestion,
	type StudentQuiz,
	quizQuery,
	submitAttemptFn,
} from "#/server/quiz-fns";

type SubmitRefusal = Extract<Awaited<ReturnType<typeof submitAttemptFn>>, { ok: false }>["reason"];
const SUBMIT_REFUSED: Record<SubmitRefusal, string> = {
	not_found: "Kuis ini sudah tidak ada.",
	forbidden: "Hanya siswa yang mengerjakan kuis.",
	not_a_quiz: "Langkah ini bukan kuis.",
	already_passed: "Kamu sudah lulus kuis ini.",
	no_attempts_left: "Percobaan sudah habis.",
	no_questions: "Kuis ini belum punya soal.",
	invalid_answer: "Ada jawaban yang tidak terbaca. Periksa lagi.",
};

type QuizTakingProps = {
	questions: readonly QuizQuestion[];
	attemptLabel: string;
	// Left out in the teacher's Pratinjau, which can't send.
	onSubmit?: (answers: Record<string, string | string[] | number>) => void;
	pending?: boolean;
	error?: string;
};

// One question at a time. Answers live only in this component until they're sent.
export function QuizTaking({ questions, attemptLabel, onSubmit, pending, error }: QuizTakingProps) {
	const [at, setAt] = useState(0);
	const [drafts, setDrafts] = useState<DraftAnswers>({});
	const [confirming, setConfirming] = useState(false);
	// Number errors show only after a first try to send, so half-typed numbers aren't flagged.
	const [tried, setTried] = useState(false);
	const [missing, setMissing] = useState(0);

	if (questions.length === 0)
		return <p className="text-sm text-muted-foreground">Belum ada soal.</p>;
	const index = Math.min(at, questions.length - 1);
	const q = questions[index];
	if (!q) return null;
	const last = index === questions.length - 1;

	function send(evenIfUnanswered: boolean) {
		if (!onSubmit) return;
		setTried(true);
		const collected = collectAnswers(questions, drafts);
		if (collected.invalid !== undefined) {
			setAt(collected.invalid);
			return;
		}
		if (collected.unanswered > 0 && !evenIfUnanswered) {
			setMissing(collected.unanswered);
			setConfirming(true);
			return;
		}
		onSubmit(collected.answers);
	}

	return (
		<>
			<div className="flex items-center gap-1.5">
				<nav aria-label="Soal" className="flex flex-wrap gap-1.5">
					{questions.map((x, i) => {
						const answered = isAnswered(drafts[x.id]);
						const current = i === index;
						return (
							<Button
								key={x.id}
								type="button"
								size="icon-sm"
								variant="outline"
								aria-current={current ? "step" : undefined}
								aria-label={`Soal ${i + 1}${answered ? ", sudah dijawab" : ""}`}
								onClick={() => setAt(i)}
								className={`tabular-nums ${answered ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : ""} ${current ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
							>
								{i + 1}
							</Button>
						);
					})}
				</nav>
				<span className="ml-auto shrink-0 text-sm text-muted-foreground">{attemptLabel}</span>
			</div>

			<section aria-label={`Soal ${index + 1}`} className="mt-8 grid gap-4">
				<p className="text-xs text-muted-foreground">
					Soal {index + 1} dari {questions.length} · {QUESTION_KIND_UI[q.kind].label}
				</p>
				<Markdown className="text-lg leading-snug font-medium text-pretty">{q.prompt}</Markdown>
				<AnswerInput
					key={q.id}
					q={q}
					value={drafts[q.id]}
					onChange={(next) => setDrafts((d) => ({ ...d, [q.id]: next }))}
					error={tried ? numberError(q, drafts[q.id]) : undefined}
				/>
			</section>

			<div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
				<Button
					type="button"
					variant="ghost"
					disabled={index === 0}
					onClick={() => setAt(index - 1)}
				>
					<ArrowLeft /> Sebelumnya
				</Button>
				<p role="alert" className="text-sm text-destructive empty:hidden">
					{error}
				</p>
				{last ? null : (
					<Button type="button" onClick={() => setAt(index + 1)}>
						Berikutnya <ArrowRight />
					</Button>
				)}
				{last && onSubmit ? (
					<Button type="button" disabled={pending} onClick={() => send(false)}>
						{pending ? "Mengirim…" : "Kirim jawaban"}
					</Button>
				) : null}
				{last && !onSubmit ? (
					<p className="text-xs text-muted-foreground">Pratinjau. Jawaban tidak dikirim.</p>
				) : null}
			</div>

			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{missing} soal belum dijawab</AlertDialogTitle>
						<AlertDialogDescription>Soal kosong dihitung salah.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Kembali</AlertDialogCancel>
						<AlertDialogAction onClick={() => send(true)}>Kirim</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// Where the student stands after an attempt. The result screen is laid out by this.
type Outcome = "passed" | "retry" | "needs_help";
const outcomeOf = (quiz: StudentQuiz): Outcome => {
	if (quiz.passed) return "passed";
	return quiz.attemptsLeft > 0 ? "retry" : "needs_help";
};

// One question in the result list. Phase 8 adds "Tanya tutor" to wrong rows, under the answer.
function ResultRow({
	q,
	number,
	attempt,
	reveal,
}: {
	q: QuizQuestion;
	number: number;
	attempt: QuizAttempt;
	reveal: NonNullable<StudentQuiz["reveal"]>[number] | undefined;
}) {
	return (
		<li className="flex items-start gap-3 border-b py-2.5">
			<Mark correct={attempt.results[q.id]} />
			<span className="mt-px w-4 shrink-0 text-sm text-muted-foreground tabular-nums">
				{number}
			</span>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<p className="line-clamp-2 text-sm">{q.prompt}</p>
				<p className="truncate text-xs text-muted-foreground">
					Jawabanmu: {answerText(q, attempt.answers[q.id])}
				</p>
				{reveal ? (
					<>
						<p className="text-xs text-muted-foreground">
							Jawaban benar:{" "}
							<span className="font-medium text-foreground">
								{keyText(q, reveal.correct, "text")}
							</span>
						</p>
						{reveal.feedback ? (
							<Markdown className="text-xs leading-5 text-muted-foreground">
								{reveal.feedback}
							</Markdown>
						) : null}
						{reveal.solution ? (
							<Markdown className="mt-1 text-sm leading-6">{reveal.solution}</Markdown>
						) : null}
					</>
				) : null}
			</div>
		</li>
	);
}

function QuizResult({
	quiz,
	attempt,
	next,
	onRetry,
}: {
	quiz: StudentQuiz;
	attempt: QuizAttempt;
	next: React.ReactNode;
	onRetry: () => void;
}) {
	const outcome = outcomeOf(quiz);
	const scores = quiz.attempts.map((a) => a.score);
	// Out of attempts, the best score is the one that counts. The list below is still the last attempt.
	const heading = {
		passed: { label: `Percobaan ${attempt.attemptNumber}`, score: attempt.score },
		retry: { label: `Percobaan ${attempt.attemptNumber}`, score: attempt.score },
		needs_help: { label: "Skor terbaik", score: Math.max(...scores) },
	}[outcome];
	const note = {
		passed: <span className="font-medium text-primary">Lulus</span>,
		retry: `Sisa ${quiz.attemptsLeft} percobaan`,
		needs_help: `${scores.join(" · ")} · percobaan habis`,
	}[outcome];
	const reveal = new Map(quiz.reveal?.map((r) => [r.questionId, r]));

	return (
		<>
			<div className="grid gap-1">
				<p className="text-xs text-muted-foreground">{heading.label}</p>
				<p>
					<span className="text-5xl font-semibold tracking-tight tabular-nums">
						{heading.score}
					</span>
					<span className="text-muted-foreground"> / 100 · perlu {quiz.settings.passScore}</span>
				</p>
				<p className="text-sm text-muted-foreground">{note}</p>
			</div>

			{outcome === "needs_help" ? (
				<p className="mt-5 text-sm">
					<span className="font-medium text-amber-700">Perlu bantuan.</span> Hubungi guru tentang
					soal yang salah.
				</p>
			) : null}

			<ol className="mt-6 border-t">
				{quiz.questions.map((q, i) => (
					<ResultRow key={q.id} q={q} number={i + 1} attempt={attempt} reveal={reveal.get(q.id)} />
				))}
			</ol>

			<div className="mt-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
				{outcome === "passed" ? (
					next
				) : (
					<p className="mr-auto text-xs text-muted-foreground">Pembahasan muncul setelah lulus.</p>
				)}
				{outcome === "retry" ? (
					<Button type="button" onClick={onRetry}>
						Coba lagi
					</Button>
				) : null}
			</div>
		</>
	);
}

type QuizTakerProps = {
	userId: string;
	classId: ClassId;
	stepId: StepId;
	nextStepId: StepId | undefined;
};

// The student's quiz: taking it when there's no attempt yet or they chose "Coba lagi", else the
// result of their last attempt, which comes from the server so it survives a reload.
export function QuizTaker({ userId, classId, stepId, nextStepId }: QuizTakerProps) {
	const queryClient = useQueryClient();
	const { data: quiz } = useSuspenseQuery(quizQuery(userId, stepId));
	const [retrying, setRetrying] = useState(false);

	const refetch = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: quizQuery(userId, stepId).queryKey }),
			queryClient.invalidateQueries({ queryKey: ["progress"] }),
		]);
	// Refetch before leaving the taking view, so the result shows this attempt, not the one before.
	// A refusal refetches too: "already passed" or "no attempts left" means this screen was out of date.
	const submit = useMutation({
		mutationFn: async (answers: Record<string, string | string[] | number>) =>
			orThrow(await submitAttemptFn({ data: { stepId, answers } })),
		onSuccess: async () => {
			await refetch();
			setRetrying(false);
		},
		onError: refetch,
	});

	const last = quiz.attempts.at(-1);
	if (!last || (retrying && quiz.attemptsLeft > 0)) {
		return (
			<QuizTaking
				// A fresh form for every attempt.
				key={quiz.attempts.length}
				questions={quiz.questions}
				attemptLabel={`Percobaan ${quiz.attempts.length + 1}/${quiz.settings.maxAttempts}`}
				onSubmit={(answers) => submit.mutate(answers)}
				pending={submit.isPending}
				error={refusalMessage(submit.error, SUBMIT_REFUSED, "Tidak bisa mengirim. Coba lagi.")}
			/>
		);
	}
	return (
		<QuizResult
			quiz={quiz}
			// After a pass, the best attempt, which is one that passed. It isn't always the last: a teacher who
			// lowers the pass score can pass an earlier one.
			attempt={quiz.passed ? quiz.attempts.reduce((a, b) => (b.score > a.score ? b : a)) : last}
			onRetry={() => {
				submit.reset();
				setRetrying(true);
			}}
			next={
				nextStepId ? (
					<Button asChild>
						<Link to="/kelas/$classId/langkah/$stepId" params={{ classId, stepId: nextStepId }}>
							Lanjut <ArrowRight />
						</Link>
					</Button>
				) : null
			}
		/>
	);
}
