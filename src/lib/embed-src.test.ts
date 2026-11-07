// Owns: tests for turning pasted links into embed addresses. Not here: the embed step's view.

import { describe, expect, it } from "vitest";
import { embedSrc } from "#/lib/embed-src";

const EMBED = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

describe("embedSrc", () => {
	it("turns every YouTube link shape into the embed address", () => {
		for (const link of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
			"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://www.youtube.com/shorts/dQw4w9WgXcQ",
		]) {
			expect(embedSrc(link)).toBe(EMBED);
		}
	});

	it("leaves other links alone", () => {
		const phet = "https://phet.colorado.edu/sims/html/forces-and-motion-basics/latest/x.html";
		expect(embedSrc(phet)).toBe(phet);
		expect(embedSrc("https://www.youtube.com/@channel")).toBe("https://www.youtube.com/@channel");
		expect(embedSrc("https://www.youtube.com/watch?v=short")).toBe(
			"https://www.youtube.com/watch?v=short",
		);
	});
});
