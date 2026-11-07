// Owns: the server functions the module and step screens call, which find the signed-in user and parse input, the queries that cache them in the browser, and turning a failed result into a thrown error for mutations. Not here: the module, step, and progress rules themselves (src/server/modules.ts).

import { queryOptions } from "@tanstack/react-query";
import { isNotFound, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { ClassId, ModuleId, StepId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import {
	ModuleInput,
	StepInput,
	VisitEventInput,
	classProgress,
	createModule,
	createStep,
	deleteModule,
	deleteStep,
	getStep,
	listModules,
	progressFor,
	recordVisit,
	reorderModules,
	reorderSteps,
	updateModule,
	updateStep,
} from "#/server/modules";

const InClass = type({ classId: ClassId });
const ForModule = type({ moduleId: ModuleId });
const ForStep = type({ stepId: StepId });

export const listModulesFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => listModules(await requireActor(), data.classId));

// Module and step fields sit under `module` and `step`. Both inputs carry a narrow or a morph,
// and ArkType's merge only takes plain objects.
export const createModuleFn = createServerFn({ method: "POST" })
	.validator(InClass.merge({ module: ModuleInput }))
	.handler(async ({ data }) => createModule(await requireActor(), data.classId, data.module));

export const updateModuleFn = createServerFn({ method: "POST" })
	.validator(ForModule.merge({ module: ModuleInput }))
	.handler(async ({ data }) => updateModule(await requireActor(), data.moduleId, data.module));

export const deleteModuleFn = createServerFn({ method: "POST" })
	.validator(ForModule)
	.handler(async ({ data }) => deleteModule(await requireActor(), data.moduleId));

export const reorderModulesFn = createServerFn({ method: "POST" })
	.validator(InClass.merge({ orderedIds: ModuleId.array() }))
	.handler(async ({ data }) => reorderModules(await requireActor(), data.classId, data.orderedIds));

export const getStepFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => getStep(await requireActor(), data.stepId));

export const createStepFn = createServerFn({ method: "POST" })
	.validator(ForModule.merge({ step: StepInput }))
	.handler(async ({ data }) => createStep(await requireActor(), data.moduleId, data.step));

export const updateStepFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ step: StepInput }))
	.handler(async ({ data }) => updateStep(await requireActor(), data.stepId, data.step));

export const deleteStepFn = createServerFn({ method: "POST" })
	.validator(ForStep)
	.handler(async ({ data }) => deleteStep(await requireActor(), data.stepId));

export const reorderStepsFn = createServerFn({ method: "POST" })
	.validator(ForModule.merge({ orderedIds: StepId.array() }))
	.handler(async ({ data }) => reorderSteps(await requireActor(), data.moduleId, data.orderedIds));

export const recordVisitFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ event: VisitEventInput }))
	.handler(async ({ data }) => recordVisit(await requireActor(), data.stepId, data.event));

export const progressForFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => progressFor(await requireActor(), data.classId));

export const classProgressFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => classProgress(await requireActor(), data.classId));

// Mutations throw on a failed result, so `isError` shows the form's error line.
type Result = { ok: true } | { ok: false; reason: string };
const isOk = <R extends Result>(result: R): result is Extract<R, { ok: true }> => result.ok;

const reasonOf = (result: Result) => (result.ok ? "ok" : result.reason);

export function orThrow<R extends Result>(result: R) {
	if (isOk(result)) return result;
	throw new Error(`Server said: ${reasonOf(result)}`);
}

// A failed read is the router's "not found", so a loader shows the pane's not-found screen.
// Keyed by user like the class queries. Invalidate with the bare prefix after writes.
// "Not found" won't change on a retry, so only other errors (a dropped connection) are retried.
const retry = (failures: number, error: unknown) => !isNotFound(error) && failures < 3;

export const modulesQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["modules", userId, classId],
		retry,
		queryFn: async () => {
			const result = await listModulesFn({ data: { classId } });
			if (!result.ok) throw notFound();
			return result.modules;
		},
	});
export type ModuleWithSteps = Extract<
	Awaited<ReturnType<typeof listModules>>,
	{ ok: true }
>["modules"][number];

// Students only. A teacher gets "forbidden", so the screens never ask for it.
export const progressQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["progress", userId, classId],
		retry,
		queryFn: async () => {
			const result = await progressForFn({ data: { classId } });
			if (!result.ok) throw notFound();
			return new Map(result.progress.map((p) => [p.stepId, p.status]));
		},
	});

export const stepQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["step", userId, stepId],
		retry,
		queryFn: async () => {
			const result = await getStepFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result.step;
		},
	});
