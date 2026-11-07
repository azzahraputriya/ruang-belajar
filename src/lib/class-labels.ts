// Owns: how a class role and a class title read on screen (role names, initials). Not here: the roles themselves (src/db/class-schema.ts).

import type { ClassRole } from "#/db/class-schema";

export const ROLE_LABEL: Record<ClassRole, string> = { teacher: "Guru", student: "Siswa" };

// "Fisika XI IPA 2" becomes "FX". Two letters stay readable in a 40px tile.
export function initials(title: string) {
	return title
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase())
		.join("");
}
