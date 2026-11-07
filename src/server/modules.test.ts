// Owns: tests for modules, steps, visits, and computed step status against the test database. Not here: test setup and shared helpers (src/test/).

import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db/client";
import { step } from "#/db/content-schema";
import { ClassId, ModuleId, StepId, type UserId } from "#/db/ids";
import {
	ModuleInput,
	StepInput,
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
import { acceptInvite } from "#/server/classes";
import { classWithStudent, inviteOk, makeUser } from "#/test/fixtures";

const reading = (title: string, body = "Isi bacaan") =>
	StepInput.assert({ kind: "reading", title, content: { body } });
const embed = (title: string, url = "https://phet.colorado.edu/sims/html/projectile-motion") =>
	StepInput.assert({ kind: "embed", title, content: { url, instructions: "Coba ubah sudutnya." } });

const DAY = 24 * 60 * 60 * 1000;
const later = () => new Date(Date.now() + DAY);
const earlier = () => new Date(Date.now() - DAY);

async function moduleOk(teacher: UserId, classId: ClassId, title: string, opensAt?: Date) {
	const result = await createModule(
		teacher,
		classId,
		ModuleInput.assert({ title, ...(opensAt && { opensAt }) }),
	);
	if (!result.ok) throw new Error(`createModule failed: ${result.reason}`);
	return result.module.id;
}

async function stepOk(teacher: UserId, moduleId: ModuleId, input: StepInput) {
	const result = await createStep(teacher, moduleId, input);
	if (!result.ok) throw new Error(`createStep failed: ${result.reason}`);
	return result.step.id;
}

// A class with one open module holding one reading step.
async function classWithStep() {
	const people = await classWithStudent();
	const moduleId = await moduleOk(people.guru, people.classId, "Bab 1");
	const stepId = await stepOk(people.guru, moduleId, reading("Gerak lurus"));
	return { ...people, moduleId, stepId };
}

async function moduleTitles(actor: UserId, classId: ClassId) {
	const result = await listModules(actor, classId);
	if (!result.ok) throw new Error(`listModules failed: ${result.reason}`);
	return result.modules.map((m) => ({
		title: m.title,
		position: m.position,
		steps: m.steps.map((s) => [s.title, s.position]),
	}));
}

async function statusOf(student: UserId, classId: ClassId, stepId: StepId) {
	const result = await progressFor(student, classId);
	if (!result.ok) throw new Error(`progressFor failed: ${result.reason}`);
	return result.progress.find((p) => p.stepId === stepId)?.status;
}

const missingModule = () => ModuleId.assert(randomUUID());
const missingStep = () => StepId.assert(randomUUID());

describe("input rules", () => {
	it("checks content against the shape its kind names", () => {
		expect(reading("Bacaan").content).toEqual({ body: "Isi bacaan" });
		expect(
			StepInput({ kind: "reading", title: "x", content: { url: "https://a.id" } }),
		).toBeInstanceOf(type.errors);
		expect(
			StepInput({ kind: "embed", title: "x", content: { body: "teks", instructions: "" } }),
		).toBeInstanceOf(type.errors);
		expect(StepInput({ kind: "assignment", title: "x", content: {} })).toBeInstanceOf(type.errors);
	});

	it("only accepts https URLs for embeds", () => {
		expect(embed("Simulasi").content).toEqual({
			url: "https://phet.colorado.edu/sims/html/projectile-motion",
			instructions: "Coba ubah sudutnya.",
		});
		for (const url of [
			"http://phet.colorado.edu",
			"javascript:alert(1)",
			"ftp://a.id/x",
			"bukan url",
		]) {
			expect(
				StepInput({ kind: "embed", title: "x", content: { url, instructions: "" } }),
			).toBeInstanceOf(type.errors);
		}
	});

	it("drops content keys the kind doesn't name", () => {
		const input = StepInput.assert({
			kind: "reading",
			title: "x",
			content: { body: "isi", script: "<script>" },
		});
		expect(input.content).toEqual({ body: "isi" });
	});

	it("trims titles and defaults module dates to none", () => {
		expect(ModuleInput.assert({ title: "  Bab 1 " })).toEqual({
			title: "Bab 1",
			opensAt: null,
			dueAt: null,
		});
		expect(ModuleInput({ title: "  " })).toBeInstanceOf(type.errors);
		expect(ModuleInput({ title: "Bab 1", opensAt: later(), dueAt: earlier() })).toBeInstanceOf(
			type.errors,
		);
		expect(ModuleInput({ title: "Bab 1", dueAt: earlier() })).not.toBeInstanceOf(type.errors);
		expect(StepInput({ kind: "reading", title: "", content: { body: "" } })).toBeInstanceOf(
			type.errors,
		);
	});
});

describe("step status from visits", () => {
	it("no visits is not started", async () => {
		const { siswa, classId, stepId } = await classWithStep();
		expect(await statusOf(siswa, classId, stepId)).toBe("not_started");
	});

	it("opened is in progress, and opening again keeps it there", async () => {
		const { siswa, classId, stepId } = await classWithStep();
		expect(await recordVisit(siswa, stepId, "opened")).toEqual({ ok: true });
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
		await recordVisit(siswa, stepId, "opened");
		await recordVisit(siswa, stepId, "opened");
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
	});

	it("finished is done, and later visits don't undo it", async () => {
		const { siswa, classId, stepId } = await classWithStep();
		await recordVisit(siswa, stepId, "opened");
		expect(await recordVisit(siswa, stepId, "finished")).toEqual({ ok: true });
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
		await recordVisit(siswa, stepId, "finished");
		await recordVisit(siswa, stepId, "opened");
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("finished without opened first is still done", async () => {
		const { siswa, classId, stepId } = await classWithStep();
		await recordVisit(siswa, stepId, "finished");
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("embed steps are finished by the student too", async () => {
		const { guru, siswa, classId, moduleId } = await classWithStep();
		const stepId = await stepOk(guru, moduleId, embed("Simulasi"));
		expect(await recordVisit(siswa, stepId, "finished")).toEqual({ ok: true });
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("one student's visits don't change another's status", async () => {
		const { guru, siswa, classId, stepId } = await classWithStep();
		const budi = await makeUser("budi");
		await acceptInvite(budi, await inviteOk(guru, classId, "budi"));
		await recordVisit(siswa, stepId, "finished");
		expect(await statusOf(budi, classId, stepId)).toBe("not_started");
	});

	it("progress lists every visible step in reading order", async () => {
		const { guru, siswa, classId, moduleId, stepId } = await classWithStep();
		const second = await stepOk(guru, moduleId, embed("Simulasi"));
		const nextModule = await moduleOk(guru, classId, "Bab 2");
		const third = await stepOk(guru, nextModule, reading("Hukum Newton"));
		await recordVisit(siswa, second, "opened");
		expect(await progressFor(siswa, classId)).toEqual({
			ok: true,
			progress: [
				{ stepId, status: "not_started" },
				{ stepId: second, status: "in_progress" },
				{ stepId: third, status: "not_started" },
			],
		});
	});
});

describe("who can write", () => {
	it("students are forbidden from every teacher write", async () => {
		const { siswa, classId, moduleId, stepId } = await classWithStep();
		const results = await Promise.all([
			createModule(siswa, classId, ModuleInput.assert({ title: "Bab baru" })),
			updateModule(siswa, moduleId, ModuleInput.assert({ title: "Diubah" })),
			deleteModule(siswa, moduleId),
			reorderModules(siswa, classId, [moduleId]),
			createStep(siswa, moduleId, reading("Baru")),
			updateStep(siswa, stepId, reading("Diubah")),
			deleteStep(siswa, stepId),
			reorderSteps(siswa, moduleId, [stepId]),
		]);
		expect(results).toEqual(results.map(() => ({ ok: false, reason: "forbidden" })));
		expect(await moduleTitles(siswa, classId)).toEqual([
			{ title: "Bab 1", position: 0, steps: [["Gerak lurus", 0]] },
		]);
	});

	it("teachers can't record visits and have no progress of their own", async () => {
		const { guru, classId, stepId } = await classWithStep();
		expect(await recordVisit(guru, stepId, "opened")).toEqual({ ok: false, reason: "forbidden" });
		expect(await progressFor(guru, classId)).toEqual({ ok: false, reason: "forbidden" });
	});

	it("students can't read class progress", async () => {
		const { siswa, classId } = await classWithStep();
		expect(await classProgress(siswa, classId)).toEqual({ ok: false, reason: "forbidden" });
	});

	it("a step keeps its kind when edited", async () => {
		const { guru, stepId } = await classWithStep();
		expect(await updateStep(guru, stepId, embed("Simulasi"))).toEqual({
			ok: false,
			reason: "kind_changed",
		});
		expect(await updateStep(guru, stepId, reading("Gerak lurus", "Isi baru"))).toMatchObject({
			ok: true,
			step: { kind: "reading", content: { body: "Isi baru" } },
		});
		expect(await getStep(guru, stepId)).toMatchObject({ step: { content: { body: "Isi baru" } } });
	});
});

describe("outsiders", () => {
	it("get the same not_found from every operation as for ids that don't exist", async () => {
		const { orang, classId, moduleId, stepId } = await classWithStep();
		const missingC = ClassId.assert(randomUUID());
		const missingM = missingModule();
		const missingS = missingStep();
		const pairs = [
			[listModules(orang, classId), listModules(orang, missingC)],
			[
				createModule(orang, classId, ModuleInput.assert({ title: "x" })),
				createModule(orang, missingC, ModuleInput.assert({ title: "x" })),
			],
			[
				updateModule(orang, moduleId, ModuleInput.assert({ title: "x" })),
				updateModule(orang, missingM, ModuleInput.assert({ title: "x" })),
			],
			[deleteModule(orang, moduleId), deleteModule(orang, missingM)],
			[reorderModules(orang, classId, [moduleId]), reorderModules(orang, missingC, [])],
			[createStep(orang, moduleId, reading("x")), createStep(orang, missingM, reading("x"))],
			[updateStep(orang, stepId, reading("x")), updateStep(orang, missingS, reading("x"))],
			[deleteStep(orang, stepId), deleteStep(orang, missingS)],
			[reorderSteps(orang, moduleId, [stepId]), reorderSteps(orang, missingM, [])],
			[getStep(orang, stepId), getStep(orang, missingS)],
			[recordVisit(orang, stepId, "opened"), recordVisit(orang, missingS, "opened")],
			[progressFor(orang, classId), progressFor(orang, missingC)],
			[classProgress(orang, classId), classProgress(orang, missingC)],
		];
		for (const [a, b] of await Promise.all(pairs.map((pair) => Promise.all(pair)))) {
			expect(a).toEqual({ ok: false, reason: "not_found" });
			expect(a).toEqual(b);
		}
	});

	it("a student in one class can't reach another class's steps", async () => {
		const a = await classWithStep();
		const b = await classWithStudent("b_");
		const bModule = await moduleOk(b.guru, b.classId, "Bab B");
		const bStep = await stepOk(b.guru, bModule, reading("Rahasia kelas B"));
		const notFound = { ok: false, reason: "not_found" };
		expect(await getStep(a.siswa, bStep)).toEqual(notFound);
		expect(await recordVisit(a.siswa, bStep, "finished")).toEqual(notFound);
		expect(await listModules(a.siswa, b.classId)).toEqual(notFound);
		expect(await progressFor(a.siswa, b.classId)).toEqual(notFound);
		// A teacher of class A gets nothing from class B either.
		expect(await updateStep(a.guru, bStep, reading("x"))).toEqual(notFound);
		expect(await reorderSteps(a.guru, bModule, [bStep])).toEqual(notFound);
	});
});

// classWithStep plus a second module that opens tomorrow.
async function classWithHiddenModule() {
	const people = await classWithStep();
	const hidden = await moduleOk(people.guru, people.classId, "Bab 2", later());
	const hiddenStep = await stepOk(people.guru, hidden, reading("Belum waktunya"));
	return { ...people, hidden, hiddenStep };
}

describe("modules that haven't opened yet", () => {
	it("are invisible to students, and their steps are not_found", async () => {
		const { siswa, classId, stepId, hiddenStep } = await classWithHiddenModule();
		expect(await moduleTitles(siswa, classId)).toEqual([
			{ title: "Bab 1", position: 0, steps: [["Gerak lurus", 0]] },
		]);
		const notFound = { ok: false, reason: "not_found" };
		expect(await getStep(siswa, hiddenStep)).toEqual(notFound);
		expect(await recordVisit(siswa, hiddenStep, "opened")).toEqual(notFound);
		// Hidden comes before forbidden, so a student can't learn the step exists by trying to edit it.
		expect(await updateStep(siswa, hiddenStep, reading("x"))).toEqual(notFound);
		expect(await progressFor(siswa, classId)).toEqual({
			ok: true,
			progress: [{ stepId, status: "not_started" }],
		});
	});

	it("are visible to teachers, with content", async () => {
		const { guru, classId, hiddenStep } = await classWithHiddenModule();
		expect(await moduleTitles(guru, classId)).toEqual([
			{ title: "Bab 1", position: 0, steps: [["Gerak lurus", 0]] },
			{ title: "Bab 2", position: 1, steps: [["Belum waktunya", 0]] },
		]);
		expect(await getStep(guru, hiddenStep)).toMatchObject({
			ok: true,
			step: { kind: "reading", content: { body: "Isi bacaan" } },
		});
	});

	it("show up for students once their opening time has passed", async () => {
		const { guru, siswa, classId, hidden, hiddenStep } = await classWithHiddenModule();
		await updateModule(guru, hidden, ModuleInput.assert({ title: "Bab 2", opensAt: earlier() }));
		expect(await getStep(siswa, hiddenStep)).toMatchObject({ ok: true });
		expect((await moduleTitles(siswa, classId)).map((m) => m.title)).toEqual(["Bab 1", "Bab 2"]);
	});
});

describe("order", () => {
	it("new modules and steps go last, even when created at the same moment", async () => {
		const { guru, classId, moduleId } = await classWithStep();
		await Promise.all(["A", "B", "C", "D"].map((t) => stepOk(guru, moduleId, reading(t))));
		await Promise.all(["Bab 2", "Bab 3", "Bab 4"].map((t) => moduleOk(guru, classId, t)));
		const modules = await moduleTitles(guru, classId);
		expect(modules.map((m) => m.position)).toEqual([0, 1, 2, 3]);
		expect(modules[0]?.steps.map(([, position]) => position)).toEqual([0, 1, 2, 3, 4]);
	});

	it("reorders modules and steps", async () => {
		const { guru, classId, moduleId, stepId } = await classWithStep();
		const second = await moduleOk(guru, classId, "Bab 2");
		const otherStep = await stepOk(guru, moduleId, reading("Kedua"));
		expect(await reorderModules(guru, classId, [second, moduleId])).toEqual({ ok: true });
		expect(await reorderSteps(guru, moduleId, [otherStep, stepId])).toEqual({ ok: true });
		expect(await moduleTitles(guru, classId)).toEqual([
			{ title: "Bab 2", position: 0, steps: [] },
			{
				title: "Bab 1",
				position: 1,
				steps: [
					["Kedua", 0],
					["Gerak lurus", 1],
				],
			},
		]);
	});

	it("refuses a reorder that isn't exactly the current ids, and changes nothing", async () => {
		const { guru, classId, moduleId, stepId } = await classWithStep();
		const second = await moduleOk(guru, classId, "Bab 2");
		const third = await moduleOk(guru, classId, "Bab 3");
		const otherStep = await stepOk(guru, moduleId, reading("Kedua"));
		const before = await moduleTitles(guru, classId);
		const mismatch = { ok: false, reason: "ids_mismatch" };
		const wrongModuleLists = [
			[third, second],
			[third, second, moduleId, missingModule()],
			[third, second, missingModule()],
			[third, third, second],
			[],
		];
		const wrongStepLists = [
			[otherStep],
			[otherStep, stepId, missingStep()],
			[otherStep, otherStep],
		];
		const results = await Promise.all([
			...wrongModuleLists.map((ids) => reorderModules(guru, classId, ids)),
			...wrongStepLists.map((ids) => reorderSteps(guru, moduleId, ids)),
		]);
		expect(results).toEqual(results.map(() => mismatch));
		expect(await moduleTitles(guru, classId)).toEqual(before);
	});

	it("two deletes of one step at once: one succeeds, the other is not_found", async () => {
		const { guru, classId, moduleId, stepId } = await classWithStep();
		await stepOk(guru, moduleId, reading("Kedua"));
		const both = await Promise.all([deleteStep(guru, stepId), deleteStep(guru, stepId)]);
		expect(both).toEqual(
			expect.arrayContaining([{ ok: true }, { ok: false, reason: "not_found" }]),
		);
		expect(await moduleTitles(guru, classId)).toEqual([
			{ title: "Bab 1", position: 0, steps: [["Kedua", 0]] },
		]);
	});

	it("an edit racing a delete is ok or not_found, never kind_changed", async () => {
		const { guru, stepId } = await classWithStep();
		const [, edited] = await Promise.all([
			deleteStep(guru, stepId),
			updateStep(guru, stepId, reading("Diubah")),
		]);
		expect(edited.ok || edited.reason === "not_found").toBe(true);
	});

	it("accepts uppercase ids in a reorder", async () => {
		const { guru, classId, moduleId } = await classWithStep();
		const second = await moduleOk(guru, classId, "Bab 2");
		const upper = [second, moduleId].map((id) => ModuleId.assert(id.toUpperCase()));
		expect(await reorderModules(guru, classId, upper)).toEqual({ ok: true });
		expect((await moduleTitles(guru, classId)).map((m) => m.title)).toEqual(["Bab 2", "Bab 1"]);
	});

	it("refuses a step from another module in a step reorder", async () => {
		const { guru, classId, moduleId, stepId } = await classWithStep();
		const second = await moduleOk(guru, classId, "Bab 2");
		const foreign = await stepOk(guru, second, reading("Di bab 2"));
		expect(await reorderSteps(guru, moduleId, [foreign])).toEqual({
			ok: false,
			reason: "ids_mismatch",
		});
		expect(await reorderSteps(guru, moduleId, [stepId])).toEqual({ ok: true });
	});

	it("keeps positions dense after a delete", async () => {
		const { guru, classId, moduleId, stepId } = await classWithStep();
		const middle = await stepOk(guru, moduleId, reading("Tengah"));
		await stepOk(guru, moduleId, reading("Akhir"));
		const second = await moduleOk(guru, classId, "Bab 2");
		await moduleOk(guru, classId, "Bab 3");
		expect(await deleteStep(guru, middle)).toEqual({ ok: true });
		expect(await deleteModule(guru, second)).toEqual({ ok: true });
		expect(await moduleTitles(guru, classId)).toEqual([
			{
				title: "Bab 1",
				position: 0,
				steps: [
					["Gerak lurus", 0],
					["Akhir", 1],
				],
			},
			{ title: "Bab 3", position: 1, steps: [] },
		]);
		expect(await deleteStep(guru, middle)).toEqual({ ok: false, reason: "not_found" });
		expect(await deleteModule(guru, moduleId)).toEqual({ ok: true });
		expect(await getStep(guru, stepId)).toEqual({ ok: false, reason: "not_found" });
	});
});

describe("class progress", () => {
	it("lists every student on every step, hidden modules included", async () => {
		const { guru, siswa, classId, moduleId, stepId } = await classWithStep();
		const budi = await makeUser("budi");
		await acceptInvite(budi, await inviteOk(guru, classId, "budi"));
		const hidden = await moduleOk(guru, classId, "Bab 2", later());
		const hiddenStep = await stepOk(guru, hidden, embed("Simulasi"));
		await recordVisit(siswa, stepId, "finished");
		const result = await classProgress(guru, classId);
		expect(result).toEqual({
			ok: true,
			steps: [
				{ id: stepId, moduleId, kind: "reading", title: "Gerak lurus" },
				{ id: hiddenStep, moduleId: hidden, kind: "embed", title: "Simulasi" },
			],
			students: [
				{
					userId: siswa,
					username: "siswa",
					name: "siswa",
					progress: [
						{ stepId, status: "done" },
						{ stepId: hiddenStep, status: "not_started" },
					],
				},
				{
					userId: budi,
					username: "budi",
					name: "budi",
					progress: [
						{ stepId, status: "not_started" },
						{ stepId: hiddenStep, status: "not_started" },
					],
				},
			],
		});
	});
});

describe("server functions", () => {
	// Nothing else loads this file yet, and a bad validator (e.g. merging a narrowed type) throws on import.
	it("load, so every validator builds", async () => {
		const fns = await import("#/server/module-fns");
		expect(Object.keys(fns)).toContain("createModuleFn");
	});
});

describe("stored content", () => {
	it("is parsed on every read, so a bad row fails loudly instead of reaching the app", async () => {
		const { guru, stepId } = await classWithStep();
		await db
			.update(step)
			.set({ content: { body: 42 } })
			.where(eq(step.id, stepId));
		await expect(getStep(guru, stepId)).rejects.toThrow(/invalid reading content/);
	});
});
