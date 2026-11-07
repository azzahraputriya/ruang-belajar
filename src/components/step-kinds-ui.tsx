// Owns: how each step kind looks on screen, meaning its label, icon, student view, editor fields, empty content, and client checks, plus the markdown renderer they share. Not here: each kind's stored shape and status rule (src/server/step-kinds.ts).

import { BookOpen, ExternalLink, PlayCircle, type LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { TextareaField, FormField } from "#/components/form-field";
import type { StepKind } from "#/db/content-schema";
import { embedSrc } from "#/lib/embed-src";
import type { STEP_KINDS } from "#/server/step-kinds";

type ContentMap = { [K in StepKind]: (typeof STEP_KINDS)[K]["content"]["infer"] };
export type ContentOf<K extends StepKind> = ContentMap[K];

// Keyed by field name, which is also the input's id, so the form can focus the first bad one.
export type FieldErrors = Partial<Record<string, string>>;

type KindUi<K extends StepKind> = {
	label: string;
	Icon: LucideIcon;
	empty: ContentOf<K>;
	View: (props: { content: ContentOf<K>; title: string }) => React.ReactNode;
	Fields: (props: {
		value: ContentOf<K>;
		onChange: (next: ContentOf<K>) => void;
		errors: FieldErrors;
	}) => React.ReactNode;
	// What the server's validator would reject. It throws instead of answering, so catch it here.
	check: (content: ContentOf<K>) => FieldErrors;
};

// Same cap as the server's Markdown type.
const MARKDOWN_MAX = 100_000;
const MARKDOWN_HINT = "Markdown. Gambar pakai tautan ![keterangan](https://…).";
const MONO = "min-h-80 font-mono text-[13px] leading-6";

// react-markdown's defaults drop raw HTML and unsafe link schemes such as javascript:.
// Keep them: no rehype-raw, no custom urlTransform, no skipHtml override.
export function Markdown({ children }: { children: string }) {
	return (
		<div className="markdown">
			<ReactMarkdown>{children}</ReactMarkdown>
		</div>
	);
}

function isHttps(raw: string) {
	try {
		return new URL(raw).protocol === "https:";
	} catch {
		return false;
	}
}

// A mapped type, not a Record, so a new kind in the enum fails to compile until it has an entry,
// and indexing with a generic kind keeps that kind's content type.
export const STEP_KIND_UI: { [K in StepKind]: KindUi<K> } = {
	reading: {
		label: "Bacaan",
		Icon: BookOpen,
		empty: { body: "" },
		View: ({ content }) => <Markdown>{content.body}</Markdown>,
		Fields: ({ value, onChange, errors }) => (
			<TextareaField
				id="body"
				label="Isi bacaan"
				hint={MARKDOWN_HINT}
				error={errors.body}
				className={MONO}
				maxLength={MARKDOWN_MAX}
				value={value.body}
				onChange={(e) => onChange({ body: e.target.value })}
			/>
		),
		check: () => ({}),
	},
	embed: {
		label: "Tautan",
		Icon: PlayCircle,
		empty: { url: "", instructions: "" },
		View: ({ content, title }) => (
			<div className="grid gap-4">
				{content.instructions ? <Markdown>{content.instructions}</Markdown> : null}
				{/* Saved links are always https. Only a teacher's Pratinjau can hold a half-typed one. */}
				{isHttps(content.url) ? (
					<>
						<iframe
							src={embedSrc(content.url)}
							title={title}
							className="aspect-video w-full rounded-lg border bg-muted"
							// allow-same-origin gives the framed page its own origin's storage, not ours. YouTube and most
							// simulations need it with scripts to play. A same-origin URL is just this app, which the student can open anyway.
							// oxlint-disable-next-line react/iframe-missing-sandbox -- the reason is above.
							sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
							loading="lazy"
							referrerPolicy="strict-origin-when-cross-origin"
							allowFullScreen
						/>
						{/* Many sites refuse to be framed, so there is always a way out. */}
						<a
							href={content.url}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 justify-self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
						>
							Buka di tab baru <ExternalLink className="size-3.5" />
						</a>
					</>
				) : null}
			</div>
		),
		Fields: ({ value, onChange, errors }) => (
			<>
				<FormField
					id="url"
					label="Tautan"
					type="url"
					inputMode="url"
					placeholder="https://www.youtube.com/watch?v=…"
					autoComplete="off"
					hint="YouTube atau situs lain yang bisa ditampilkan di halaman."
					error={errors.url}
					value={value.url}
					onChange={(e) => onChange({ ...value, url: e.target.value })}
				/>
				<TextareaField
					id="instructions"
					label="Petunjuk"
					hint={MARKDOWN_HINT}
					error={errors.instructions}
					className="min-h-40 font-mono text-[13px] leading-6"
					maxLength={MARKDOWN_MAX}
					value={value.instructions}
					onChange={(e) => onChange({ ...value, instructions: e.target.value })}
				/>
			</>
		),
		check: ({ url }) => (isHttps(url.trim()) ? {} : { url: "Isi tautan yang diawali https://." }),
	},
};

export function KindIcon({ kind, className = "size-4" }: { kind: StepKind; className?: string }) {
	const { Icon } = STEP_KIND_UI[kind];
	return <Icon aria-hidden="true" className={`shrink-0 text-muted-foreground ${className}`} />;
}

// Generic, so the content's type follows the kind without a cast.
export function StepView<K extends StepKind>(props: {
	kind: K;
	content: ContentOf<K>;
	title: string;
}) {
	const { View } = STEP_KIND_UI[props.kind];
	return <View content={props.content} title={props.title} />;
}

export function StepFields<K extends StepKind>(props: {
	kind: K;
	value: ContentOf<K>;
	onChange: (next: ContentOf<K>) => void;
	errors: FieldErrors;
}) {
	const { Fields } = STEP_KIND_UI[props.kind];
	return <Fields value={props.value} onChange={props.onChange} errors={props.errors} />;
}

export const checkStepContent = <K extends StepKind>(kind: K, content: ContentOf<K>) =>
	STEP_KIND_UI[kind].check(content);

// Parses the `jenis` search param without pulling the server's enum into the browser bundle.
export const isStepKind = (value: unknown): value is StepKind =>
	typeof value === "string" && Object.hasOwn(STEP_KIND_UI, value);

// Every kind, in the registry's order, for the "+ Langkah" choice.
export const STEP_KIND_LIST = Object.keys(STEP_KIND_UI).filter(isStepKind);
