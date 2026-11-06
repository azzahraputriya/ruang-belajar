// Owns: the server functions the module and step screens call, which find the signed-in user and parse input. Not here: the module, step, and progress rules themselves (src/server/modules.ts).

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

export const createModuleFn = createServerFn({ method: "POST" })
	.validator(ModuleInput.merge(InClass))
	.handler(async ({ data: { classId, ...input } }) =>
		createModule(await requireActor(), classId, input),
	);

export const updateModuleFn = createServerFn({ method: "POST" })
	.validator(ModuleInput.merge(ForModule))
	.handler(async ({ data: { moduleId, ...input } }) =>
		updateModule(await requireActor(), moduleId, input),
	);

export const deleteModuleFn = createServerFn({ method: "POST" })
	.validator(ForModule)
	.handler(async ({ data }) => deleteModule(await requireActor(), data.moduleId));

export const reorderModulesFn = createServerFn({ method: "POST" })
	.validator(InClass.merge({ orderedIds: ModuleId.array() }))
	.handler(async ({ data }) => reorderModules(await requireActor(), data.classId, data.orderedIds));

export const getStepFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => getStep(await requireActor(), data.stepId));

// The step's own fields sit under `step`, because StepInput is a morph and can't be merged into another object.
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
