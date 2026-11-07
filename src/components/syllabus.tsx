// Owns: the syllabus tree beside the open step (desktop aside and phone bar), with each step's status or kind icon and the teacher's add links. Not here: the panes it links to (src/routes/_app/kelas/$classId/) or reading-order rules (src/lib/reading-order.ts).

import { Link, useLocation, useParams } from "@tanstack/react-router";
import { Check, ChevronDown, Circle, CircleDashed, Plus } from "lucide-react";
import { useState } from "react";
import { KindIcon, STEP_KIND_LIST, STEP_KIND_UI } from "#/components/step-kinds-ui";
import type { ClassId, StepId } from "#/db/ids";
import { isFinished, placeInModule } from "#/lib/reading-order";
import { formatDay } from "#/lib/wib";
import type { ModuleWithSteps } from "#/server/module-fns";
import type { StepStatus } from "#/server/step-kinds";

const STATUS_LABEL: Record<StepStatus, string> = {
	not_started: "Belum dibuka",
	in_progress: "Sedang dibaca",
	needs_help: "Perlu bantuan",
	done: "Selesai",
	graded: "Dinilai",
};

// The label is for screen readers. The icon alone carries it on screen.
export function StatusIcon({
	status,
	className = "size-4",
}: {
	status: StepStatus;
	className?: string;
}) {
	const label = <span className="sr-only">{STATUS_LABEL[status]}</span>;
	if (isFinished(status)) {
		return (
			<>
				<span
					aria-hidden="true"
					className={`grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground ${className}`}
				>
					<Check className="size-[70%]" strokeWidth={3} />
				</span>
				{label}
			</>
		);
	}
	const Icon = status === "not_started" ? Circle : CircleDashed;
	const tone = status === "not_started" ? "text-muted-foreground/50" : "text-primary";
	return (
		<>
			<Icon aria-hidden="true" className={`shrink-0 ${tone} ${className}`} />
			{label}
		</>
	);
}

export type SyllabusProps = {
	classId: ClassId;
	teacher: boolean;
	modules: readonly ModuleWithSteps[];
	// Students only. Teachers see kind icons instead.
	statusById: ReadonlyMap<StepId, StepStatus> | undefined;
};

const statusOf = (props: SyllabusProps, stepId: StepId) =>
	props.statusById?.get(stepId) ?? "not_started";

// What the module header says on the right: when it opens if that's later, else the student's
// count or the teacher's due date.
function moduleNote(props: SyllabusProps, module: ModuleWithSteps, now: Date) {
	if (module.opensAt && module.opensAt > now) return `Dibuka ${formatDay(module.opensAt)}`;
	if (props.teacher) return module.dueAt ? formatDay(module.dueAt) : "";
	const done = module.steps.filter((s) => isFinished(statusOf(props, s.id))).length;
	return `${done}/${module.steps.length}`;
}

// A link inside an open <details> doesn't close it, so close it by hand.
const closeMenu = (event: React.MouseEvent<HTMLElement>) =>
	event.currentTarget.closest("details")?.removeAttribute("open");

const ROW = "mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted";
const ACTIVE = { className: "bg-primary/10 font-medium text-primary hover:bg-primary/10" };

function SyllabusTree(props: SyllabusProps) {
	const { classId, teacher, modules } = props;
	// Fixed at mount: "opens later" doesn't need to tick over while the page is open.
	const [now] = useState(() => new Date());
	return (
		<>
			{modules.length === 0 ? (
				<p className="px-4 py-1.5 text-sm text-muted-foreground">Belum ada modul.</p>
			) : null}
			{modules.map((m, i) => {
				const heading = (
					<>
						<span className="flex-1 truncate tracking-wide uppercase">
							{i + 1}. {m.title}
						</span>
						<span className="shrink-0 font-normal">{moduleNote(props, m, now)}</span>
					</>
				);
				return (
					<section key={m.id} aria-label={m.title} className="mb-3">
						{teacher ? (
							<Link
								to="/kelas/$classId/modul/$moduleId"
								params={{ classId, moduleId: m.id }}
								className="mx-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
								activeProps={{ className: "bg-primary/10 text-primary hover:bg-primary/10" }}
							>
								{heading}
							</Link>
						) : (
							<h2 className="mx-2 flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground">
								{heading}
							</h2>
						)}
						{m.steps.map((s) => (
							<Link
								key={s.id}
								to="/kelas/$classId/langkah/$stepId"
								params={{ classId, stepId: s.id }}
								className={ROW}
								activeProps={ACTIVE}
							>
								{teacher ? (
									<KindIcon kind={s.kind} className="size-3.5" />
								) : (
									<StatusIcon status={statusOf(props, s.id)} className="size-3.5" />
								)}
								<span className="truncate">{s.title}</span>
							</Link>
						))}
						{teacher ? (
							<details className="mx-2">
								<summary className="flex h-7 w-fit cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[0.8rem] text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden">
									<Plus className="size-3.5" /> Langkah
								</summary>
								<div className="grid pt-0.5 pl-4">
									{STEP_KIND_LIST.map((kind) => (
										<Link
											key={kind}
											to="/kelas/$classId/langkah-baru"
											params={{ classId }}
											search={{ modul: m.id, jenis: kind }}
											onClick={closeMenu}
											className="flex h-7 items-center gap-2 rounded-md px-2 text-[0.8rem] hover:bg-muted"
										>
											<KindIcon kind={kind} className="size-3.5" />
											{STEP_KIND_UI[kind].label}
										</Link>
									))}
								</div>
							</details>
						) : null}
					</section>
				);
			})}
			{teacher ? (
				<Link
					to="/kelas/$classId/modul-baru"
					params={{ classId }}
					className="mx-4 inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
					activeProps={{ className: "border-primary text-primary" }}
				>
					<Plus className="size-3.5" /> Modul
				</Link>
			) : null}
		</>
	);
}

// Desktop: the whole tree, always beside the pane. It sticks while a long step scrolls.
export function SyllabusAside(props: SyllabusProps) {
	return (
		<div className="hidden w-72 shrink-0 border-r md:block">
			<nav aria-label="Silabus" className="sticky top-0 max-h-svh overflow-y-auto py-3">
				<SyllabusTree {...props} />
			</nav>
		</div>
	);
}

// Phone: one bar above the pane that unfolds the same tree. Keyed by the address, so it folds
// again after any navigation.
export function SyllabusBar(props: SyllabusProps) {
	const href = useLocation({ select: (l) => l.href });
	const { stepId } = useParams({ strict: false });
	const step = props.modules.flatMap((m) => m.steps).find((s) => s.id === stepId);
	const place = step && placeInModule(props.modules, step.id);
	return (
		<details key={href} className="group border-b md:hidden">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
				{step && props.teacher ? <KindIcon kind={step.kind} /> : null}
				{step && !props.teacher ? <StatusIcon status={statusOf(props, step.id)} /> : null}
				<span className="min-w-0 flex-1 truncate">
					{place ? (
						<>
							<span className="text-muted-foreground">{place.module.title} · </span>
							{place.index} dari {place.total}
						</>
					) : (
						"Silabus"
					)}
				</span>
				<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
			</summary>
			<nav aria-label="Silabus" className="border-t py-3">
				<SyllabusTree {...props} />
			</nav>
		</details>
	);
}
