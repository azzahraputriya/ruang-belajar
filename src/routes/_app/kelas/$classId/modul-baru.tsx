// Owns: the teacher's new-module pane at /kelas/$classId/modul-baru. Not here: the module form (src/components/module-form.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { NewModule } from "#/components/module-form";
import { PaneMessage } from "#/components/pane-message";
import { ClassId } from "#/db/ids";

export const Route = createFileRoute("/_app/kelas/$classId/modul-baru")({
	loader: async ({ params, parentMatchPromise }) => {
		const classId = ClassId(params.classId);
		const { loaderData } = await parentMatchPromise;
		if (classId instanceof type.errors || loaderData?.cls.myRole !== "teacher") throw notFound();
		return { classId };
	},
	component: NewModulePane,
	notFoundComponent: () => <PaneMessage title="Halaman tidak ditemukan." />,
});

function NewModulePane() {
	const { classId } = Route.useLoaderData();
	return <NewModule classId={classId} />;
}
