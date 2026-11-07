// Owns: the step pane at /kelas/$classId/langkah/$stepId, which is the reader for students and the editor for teachers, and its not-found message. Not here: the reader (src/components/step-reader.tsx) or the editor (src/components/step-form.tsx).

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { PaneMessage } from "#/components/pane-message";
import { StepReader } from "#/components/step-reader";
import { ClassId, StepId } from "#/db/ids";
import { modulesQuery, progressQuery, stepQuery } from "#/server/module-fns";

const classRoute = getRouteApi("/_app/kelas/$classId");

export const Route = createFileRoute("/_app/kelas/$classId/langkah/$stepId")({
	// A step from another of your classes is not found here too, so the syllabus beside it always matches.
	loader: async ({ params, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const stepId = StepId(params.stepId);
		if (classId instanceof type.errors || stepId instanceof type.errors) throw notFound();
		const [step, modules] = await Promise.all([
			queryClient.ensureQueryData(stepQuery(user.id, stepId)),
			queryClient.ensureQueryData(modulesQuery(user.id, classId)),
		]);
		if (!modules.some((m) => m.id === step.moduleId)) throw notFound();
		return { classId, stepId };
	},
	component: StepPane,
	notFoundComponent: () => <PaneMessage title="Langkah tidak ditemukan." />,
});

function StepPane() {
	const { classId, stepId } = Route.useLoaderData();
	const { user } = Route.useRouteContext();
	const { cls } = classRoute.useLoaderData();
	const student = cls.myRole === "student";
	const { data: step } = useSuspenseQuery(stepQuery(user.id, stepId));
	const { data: modules } = useSuspenseQuery(modulesQuery(user.id, classId));
	const { data: statusById } = useQuery({ ...progressQuery(user.id, classId), enabled: student });

	if (student) {
		return (
			<StepReader
				key={step.id}
				classId={classId}
				step={step}
				modules={modules}
				statusById={statusById ?? new Map()}
			/>
		);
	}
	return null;
}
