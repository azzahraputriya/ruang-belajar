// Owns: the teacher's fields for an assignment step (prompt, what students hand in, the optional rubric) and their client checks. Not here: the step editor around them (src/components/step-form.tsx) or the registry that picks them (src/components/step-kinds-ui.tsx).

import { Plus, Trash2 } from "lucide-react";
import { TextareaField } from "#/components/form-field";
import type { ContentOf, FieldErrors } from "#/components/step-kinds-ui";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { MARKDOWN_HINT, MARKDOWN_MAX } from "#/lib/markdown-field";

type Assignment = ContentOf<"assignment">;
type Criterion = NonNullable<Assignment["rubric"]>[number];

// The server's limits for a rubric.
const MAX_CRITERIA = 20;
const POINTS_RANGE = [1, 100] as const;

// Error keys match the inputs' names, so the form can focus the first bad one.
const titleKey = (i: number) => `rubric-${i}-title`;
const pointsKey = (i: number) => `rubric-${i}-maxPoints`;

// Same rules as the server's AssignmentContent.
export function checkAssignment(content: Assignment): FieldErrors {
	const errors: FieldErrors = {};
	if (!content.accepts.text && !content.accepts.files) {
		errors.accepts = "Pilih teks, berkas, atau keduanya.";
	}
	(content.rubric ?? []).forEach((c, i) => {
		if (!c.title.trim()) errors[titleKey(i)] = "Isi nama kriteria.";
		const [min, max] = POINTS_RANGE;
		if (!Number.isInteger(c.maxPoints) || c.maxPoints < min || c.maxPoints > max) {
			errors[pointsKey(i)] = `Poin ${min} sampai ${max}.`;
		}
	});
	return errors;
}

const numberValue = (n: number) => (Number.isNaN(n) ? "" : n);

export function AssignmentFields({
	value,
	onChange,
	errors,
}: {
	value: Assignment;
	onChange: (next: Assignment) => void;
	errors: FieldErrors;
}) {
	const rubric = value.rubric ?? [];
	// No criteria means no rubric key at all: the server wants at least one when it is there.
	const setRubric = (next: Criterion[]) =>
		onChange({
			prompt: value.prompt,
			accepts: value.accepts,
			...(next.length > 0 && { rubric: next }),
		});
	const setCriterion = (at: number, patch: Partial<Criterion>) =>
		setRubric(rubric.map((c, i) => (i === at ? { ...c, ...patch } : c)));
	const setAccepts = (patch: Partial<Assignment["accepts"]>) =>
		onChange({ ...value, accepts: { ...value.accepts, ...patch } });

	return (
		<>
			<TextareaField
				id="prompt"
				label="Perintah"
				hint={MARKDOWN_HINT}
				error={errors.prompt}
				className="min-h-40 font-mono text-[13px] leading-6"
				maxLength={MARKDOWN_MAX}
				value={value.prompt}
				onChange={(e) => onChange({ ...value, prompt: e.target.value })}
			/>
			<fieldset
				className="grid gap-2"
				aria-describedby={errors.accepts ? "accepts-note" : undefined}
			>
				<legend className="mb-2 text-sm font-medium">Siswa mengumpulkan</legend>
				<div className="flex flex-wrap gap-5">
					<Label className="font-normal">
						<Checkbox
							id="accepts"
							checked={value.accepts.text}
							aria-invalid={errors.accepts ? true : undefined}
							onCheckedChange={(checked) => setAccepts({ text: checked === true })}
						/>
						Teks
					</Label>
					<Label className="font-normal">
						<Checkbox
							checked={value.accepts.files}
							aria-invalid={errors.accepts ? true : undefined}
							onCheckedChange={(checked) => setAccepts({ files: checked === true })}
						/>
						Berkas
					</Label>
				</div>
				{errors.accepts ? (
					<p id="accepts-note" className="text-xs text-destructive">
						{errors.accepts}
					</p>
				) : null}
			</fieldset>
			<div className="grid gap-2">
				<div className="flex flex-wrap items-baseline gap-x-2">
					<p className="text-sm font-medium">Rubrik</p>
					<p className="text-xs text-muted-foreground">
						Opsional. Tanpa rubrik, nilai 0 sampai 100.
					</p>
					{rubric.length > 0 ? (
						<p className="ml-auto text-xs text-muted-foreground tabular-nums">
							{/* An empty points box holds NaN, counted as 0 until it is filled. */}
							Total {rubric.reduce((sum, c) => sum + (c.maxPoints || 0), 0)} poin
						</p>
					) : null}
				</div>
				{rubric.length > 0 ? (
					<ol className="grid gap-3 border-t pt-3">
						{rubric.map((c, i) => {
							const problems = [errors[titleKey(i)], errors[pointsKey(i)]].filter(Boolean);
							return (
								<li
									key={c.id}
									className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_1.75rem] items-start gap-2"
								>
									<span className="pt-1.5 text-sm text-muted-foreground tabular-nums">{i + 1}</span>
									<div className="grid gap-1">
										<Input
											id={titleKey(i)}
											name={titleKey(i)}
											aria-label={`Kriteria ${i + 1}`}
											aria-invalid={errors[titleKey(i)] ? true : undefined}
											placeholder="Kriteria"
											maxLength={200}
											value={c.title}
											onChange={(e) => setCriterion(i, { title: e.target.value })}
											className="h-8"
										/>
										<Input
											aria-label={`Keterangan kriteria ${i + 1}`}
											placeholder="Keterangan"
											maxLength={MARKDOWN_MAX}
											value={c.description ?? ""}
											onChange={(e) => setCriterion(i, { description: e.target.value })}
											className="h-7 text-xs"
										/>
										{problems.length > 0 ? (
											<p className="text-xs text-destructive">{problems.join(" ")}</p>
										) : null}
									</div>
									<Input
										id={pointsKey(i)}
										name={pointsKey(i)}
										aria-label={`Poin maks. kriteria ${i + 1}`}
										aria-invalid={errors[pointsKey(i)] ? true : undefined}
										type="number"
										inputMode="numeric"
										min={POINTS_RANGE[0]}
										max={POINTS_RANGE[1]}
										value={numberValue(c.maxPoints)}
										onChange={(e) => setCriterion(i, { maxPoints: e.target.valueAsNumber })}
										className="h-8 tabular-nums"
									/>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label={`Hapus kriteria ${i + 1}`}
										onClick={() => setRubric(rubric.filter((_, j) => j !== i))}
									>
										<Trash2 />
									</Button>
								</li>
							);
						})}
					</ol>
				) : null}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={rubric.length >= MAX_CRITERIA}
					className="justify-self-start text-muted-foreground"
					// Made once and never rebuilt, so a grade's points stay tied to the same criterion.
					onClick={() =>
						setRubric([
							...rubric,
							{ id: crypto.randomUUID().slice(0, 8), title: "", maxPoints: 10 },
						])
					}
				>
					<Plus /> Kriteria
				</Button>
			</div>
		</>
	);
}
