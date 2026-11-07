// Owns: the teacher's module pane at /kelas/$classId/modul/$moduleId (edit, move, delete). Not here: the module form (src/components/module-form.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { PaneMessage } from "#/components/pane-message";
import { ClassId, ModuleId } from "#/db/ids";
import { modulesQuery } from "#/server/module-fns";

export const Route = createFileRoute("/_app/kelas/$classId/modul/$moduleId")({
	// Students never see this pane, so for them it doesn't exist.
	loader: async ({ params, parentMatchPromise, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const moduleId = ModuleId(params.moduleId);
		const { loaderData } = await parentMatchPromise;
		if (
			classId instanceof type.errors ||
			moduleId instanceof type.errors ||
			loaderData?.cls.myRole !== "teacher"
		) {
			throw notFound();
		}
		const modules = await queryClient.ensureQueryData(modulesQuery(user.id, classId));
		if (!modules.some((m) => m.id === moduleId)) throw notFound();
		return { classId, moduleId };
	},
	component: ModulePane,
	notFoundComponent: () => <PaneMessage title="Modul tidak ditemukan." />,
});

function ModulePane() {
	return null;
}
