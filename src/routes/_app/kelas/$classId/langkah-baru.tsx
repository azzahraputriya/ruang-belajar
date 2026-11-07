// Owns: the teacher's new-step pane at /kelas/$classId/langkah-baru?modul=…&jenis=…, which parses its search params. Not here: the step form (src/components/step-form.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { PaneMessage } from "#/components/pane-message";
import { isStepKind } from "#/components/step-kinds-ui";
import { ClassId, ModuleId } from "#/db/ids";
import { modulesQuery } from "#/server/module-fns";

// The router turns a failed validateSearch into an error screen, not "not found", so it only
// shapes the params. The loader parses them strictly.
const LooseSearch = type({ "modul?": "unknown", "jenis?": "unknown" });
const NewStepSearch = type({
	modul: ModuleId,
	jenis: type("string").pipe((kind, ctx) => (isStepKind(kind) ? kind : ctx.error("a step kind"))),
});

export const Route = createFileRoute("/_app/kelas/$classId/langkah-baru")({
	validateSearch: LooseSearch,
	loaderDeps: ({ search }) => search,
	loader: async ({ params, deps, parentMatchPromise, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const search = NewStepSearch(deps);
		const { loaderData } = await parentMatchPromise;
		if (
			classId instanceof type.errors ||
			search instanceof type.errors ||
			loaderData?.cls.myRole !== "teacher"
		) {
			throw notFound();
		}
		const modules = await queryClient.ensureQueryData(modulesQuery(user.id, classId));
		if (!modules.some((m) => m.id === search.modul)) throw notFound();
		return { classId, moduleId: search.modul, kind: search.jenis };
	},
	component: NewStepPane,
	notFoundComponent: () => <PaneMessage title="Modul tidak ditemukan." />,
});

function NewStepPane() {
	return null;
}
