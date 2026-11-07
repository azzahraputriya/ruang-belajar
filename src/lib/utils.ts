// Owns: the `cn` class-name helper shadcn/ui components import. Not here: anything app-specific.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
