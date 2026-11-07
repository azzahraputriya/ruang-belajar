// Owns: tests for reading order, resume, next step, and place in module. Not here: the screens that use them.

import { describe, expect, it } from "vitest";
import { StepId } from "#/db/ids";
import { nextStep, placeInModule, readingOrder, resumeStep } from "#/lib/reading-order";
import type { StepStatus } from "#/server/step-kinds";

const id = (n: number) => StepId.assert(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const [s1, s2, s3, s4] = [id(1), id(2), id(3), id(4)];
const modules = [
	{ title: "Gerak lurus", steps: [{ id: s1 }, { id: s2 }] },
	{ title: "Kosong", steps: [] },
	{ title: "Hukum Newton", steps: [{ id: s3 }, { id: s4 }] },
];
const statuses = (entries: [StepId, StepStatus][]) => new Map(entries);

describe("reading order", () => {
	it("goes through modules in order, skipping empty ones", () => {
		expect(readingOrder(modules).map(({ step }) => step.id)).toEqual([s1, s2, s3, s4]);
	});

	it("resumes at the first step that isn't finished", () => {
		expect(resumeStep(modules, statuses([]))?.id).toBe(s1);
		expect(resumeStep(modules, statuses([[s1, "done"]]))?.id).toBe(s2);
		expect(
			resumeStep(
				modules,
				statuses([
					[s1, "done"],
					[s2, "graded"],
					[s3, "in_progress"],
				]),
			)?.id,
		).toBe(s3);
	});

	it("resumes at the first step when every step is done, and at nothing when there are none", () => {
		const allDone = statuses([s1, s2, s3, s4].map((s) => [s, "done"]));
		expect(resumeStep(modules, allDone)?.id).toBe(s1);
		expect(resumeStep([{ steps: [] }], statuses([]))).toBeUndefined();
	});

	it("moves to the next step across modules, and stops after the last", () => {
		expect(nextStep(modules, s1)?.id).toBe(s2);
		expect(nextStep(modules, s2)?.id).toBe(s3);
		expect(nextStep(modules, s4)).toBeUndefined();
		expect(nextStep(modules, id(9))).toBeUndefined();
	});

	it("places a step within its own module", () => {
		const place = placeInModule(modules, s4);
		expect(place?.module.title).toBe("Hukum Newton");
		expect([place?.index, place?.total]).toEqual([2, 2]);
		expect(placeInModule(modules, id(9))).toBeUndefined();
	});
});
