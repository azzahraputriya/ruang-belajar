// Owns: the student's view of one step (kind and due date, title, content), the "Selesai, lanjut" bar, and recording that the step was opened. Not here: each kind's content view (src/components/step-kinds-ui.tsx), the quiz screens (src/components/quiz-taker.tsx), or the teacher's editor (src/components/step-form.tsx).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { QuizTaker } from "#/components/quiz-taker";
import { STEP_KIND_UI, StepView } from "#/components/step-kinds-ui";
import { Button } from "#/components/ui/button";
import type { StepKind } from "#/db/content-schema";
import type { ClassId, StepId } from "#/db/ids";
import { isFinished, nextStep, readingOrder } from "#/lib/reading-order";
import { formatDay } from "#/lib/wib";
import { type ModuleWithSteps, orThrow, recordVisitFn } from "#/server/module-fns";
import type { Step } from "#/server/modules";
import type { StepStatus } from "#/server/step-kinds";

// What a student sees around the step's content. The teacher's Pratinjau renders this same component.
export function StepArticle(props: {
	kind: StepKind;
	title: string;
	dueAt: Date | null;
	children: React.ReactNode;
	footer?: React.ReactNode;
}) {
	return (
		<article className="mx-auto max-w-[68ch] px-4 py-8 md:px-8">
			<p className="mb-1 text-xs text-muted-foreground">
				{STEP_KIND_UI[props.kind].label}
				{props.dueAt ? ` · tenggat ${formatDay(props.dueAt)}` : null}
			</p>
			<h1 className="mb-6 text-2xl font-semibold tracking-tight text-balance">{props.title}</h1>
			{props.children}
			{props.footer}
		</article>
	);
}

type StepReaderProps = {
	userId: string;
	classId: ClassId;
	step: Step;
	modules: readonly ModuleWithSteps[];
	statusById: ReadonlyMap<StepId, StepStatus>;
};

// Render with key={step.id}, so the finish state starts fresh on every step.
export function StepReader({ userId, classId, step, modules, statusById }: StepReaderProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const done = isFinished(statusById.get(step.id));
	const next = nextStep(modules, step.id);
	const module = modules.find((m) => m.id === step.moduleId);

	// Recorded here, not in the loader: hovering a syllabus link preloads the loader and must not
	// count as opening. Only the first opening changes the status, so later ones aren't sent.
	// Progress is only shown, so a failed write is ignored.
	const unopened = (statusById.get(step.id) ?? "not_started") === "not_started";
	useEffect(() => {
		if (!unopened) return;
		recordVisitFn({ data: { stepId: step.id, event: "opened" } })
			.then(() => queryClient.invalidateQueries({ queryKey: ["progress"] }))
			.catch(() => undefined);
	}, [unopened, step.id, queryClient]);

	const finish = useMutation({
		mutationFn: async () => {
			if (!done) orThrow(await recordVisitFn({ data: { stepId: step.id, event: "finished" } }));
		},
		// Refetch before moving on, so the next pane and the syllabus already show this step as done.
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["progress"] });
			if (next) {
				await navigate({
					to: "/kelas/$classId/langkah/$stepId",
					params: { classId, stepId: next.id },
				});
			}
		},
	});

	let note = "";
	if (finish.isSuccess && !next) {
		const allDone = readingOrder(modules).every(
			({ step: s }) => s.id === step.id || isFinished(statusById.get(s.id)),
		);
		note = allDone ? "Semua langkah selesai." : "Ini langkah terakhir.";
	}

	// A quiz is finished by passing it, not by the student saying so, so it has no "Selesai" bar.
	if (step.kind === "quiz") {
		return (
			<StepArticle kind={step.kind} title={step.title} dueAt={module?.dueAt ?? null}>
				<QuizTaker userId={userId} classId={classId} stepId={step.id} nextStepId={next?.id} />
			</StepArticle>
		);
	}

	return (
		<StepArticle
			kind={step.kind}
			title={step.title}
			dueAt={module?.dueAt ?? null}
			footer={
				<div className="mt-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t pt-4">
					<output className="text-sm text-muted-foreground empty:hidden">{note}</output>
					<p role="alert" className="text-sm text-destructive empty:hidden">
						{finish.isError ? "Tidak bisa menyimpan. Coba lagi." : ""}
					</p>
					<Button disabled={finish.isPending} onClick={() => finish.mutate()}>
						{next ? "Selesai, lanjut" : "Selesai"}
						{next ? <ArrowRight /> : null}
					</Button>
				</div>
			}
		>
			<StepView kind={step.kind} content={step.content} title={step.title} />
		</StepArticle>
	);
}
