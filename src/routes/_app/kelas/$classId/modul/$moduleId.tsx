// Owns: the teacher's module pane at /kelas/$classId/modul/$moduleId (edit, move, delete). Not here: the module form (src/components/module-form.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { useIsMutating, useSuspenseQuery } from "@tanstack/react-query";
import { ModuleEditor, deletingModuleKey } from "#/components/module-form";
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
	const deleting = useIsMutating({ mutationKey: deletingModuleKey(moduleId) }) > 0;
	const module = modules.find((m) => m.id === moduleId);
	// Gone after a refetch. While this pane's own delete is leaving for the class index, show nothing.
	// Otherwise it went elsewhere (another tab), and background refetches don't throw, so say it here.
	if (!module) return deleting ? null : <PaneMessage title="Modul tidak ditemukan." />;
	return <ModuleEditor key={module.id} classId={classId} module={module} modules={modules} />;
}
