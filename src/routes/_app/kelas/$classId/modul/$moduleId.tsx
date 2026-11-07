// Owns: the teacher's module pane at /kelas/$classId/modul/$moduleId (edit, move, delete). Not here: the module form (src/components/module-form.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ModuleEditor } from "#/components/module-form";
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
	const { classId, moduleId } = Route.useLoaderData();
	const { user } = Route.useRouteContext();
	const { data: modules } = useSuspenseQuery(modulesQuery(user.id, classId));
	const at = modules.findIndex((m) => m.id === moduleId);
	const module = modules[at];
	// Gone after a refetch, e.g. deleted in another tab.
	if (!module) return <PaneMessage title="Modul tidak ditemukan." />;
	return <ModuleEditor key={module.id} classId={classId} module={module} number={at + 1} />;
}
