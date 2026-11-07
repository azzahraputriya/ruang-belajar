// Owns: the size cap and hint every markdown field in the step editors shares. Not here: the fields themselves (src/components/step-kinds-ui.tsx, src/components/assignment-fields.tsx).

// Same cap as the server's Markdown type.
export const MARKDOWN_MAX = 100_000;
export const MARKDOWN_HINT = "Markdown. Gambar pakai tautan ![keterangan](https://…).";
