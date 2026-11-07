// Owns: the order a student reads steps in across modules, and where to resume or go next. Not here: fetching modules or progress (src/server/module-fns.ts).

import type { StepId } from "#/db/ids";
import type { StepStatus } from "#/server/step-kinds";

// Any module shape with ordered steps, so callers get their own step type back.
type Ordered = { steps: readonly { id: StepId }[] };

// Statuses that mean the student needs nothing more from the step.
const FINISHED: ReadonlySet<StepStatus> = new Set(["done", "graded"]);
export const isFinished = (status: StepStatus | undefined) =>
	status !== undefined && FINISHED.has(status);

// Every step with its module, modules in order and steps in order within each.
export function readingOrder<M extends Ordered>(modules: readonly M[]) {
	return modules.flatMap((module) =>
		module.steps.map((step: M["steps"][number]) => ({ module, step })),
	);
}

// The first step the student hasn't finished, else the first step. Undefined when there are none.
export function resumeStep<M extends Ordered>(
	modules: readonly M[],
	statusById: ReadonlyMap<StepId, StepStatus>,
) {
	const order = readingOrder(modules);
	const open = order.find(({ step }) => !isFinished(statusById.get(step.id)));
	return (open ?? order[0])?.step;
}

// The step after this one in reading order, crossing into the next module. Undefined on the last.
export function nextStep<M extends Ordered>(modules: readonly M[], stepId: StepId) {
	const order = readingOrder(modules);
	const at = order.findIndex(({ step }) => step.id === stepId);
	return at === -1 ? undefined : order[at + 1]?.step;
}

// Where a step sits in its module, for "3 dari 4". `index` counts from 1.
export function placeInModule<M extends Ordered>(modules: readonly M[], stepId: StepId) {
	for (const module of modules) {
		const at = module.steps.findIndex((step) => step.id === stepId);
		if (at !== -1) return { module, index: at + 1, total: module.steps.length };
	}
	return undefined;
}
