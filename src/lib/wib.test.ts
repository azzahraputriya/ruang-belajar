// Owns: tests for the WIB date helpers. Not here: the screens that use them.

import { describe, expect, it } from "vitest";
import { formatDay, fromWibInput, toWibInput } from "#/lib/wib";

describe("WIB dates", () => {
	it("shows the WIB day, even when UTC is still on the day before", () => {
		// 18:30 UTC on Friday is 01:30 WIB on Saturday.
		expect(formatDay(new Date("2026-11-13T18:30:00Z"))).toBe("Sab, 14 Nov");
	});

	it("writes and reads datetime-local values as WIB", () => {
		const date = new Date("2026-11-13T18:30:00Z");
		expect(toWibInput(date)).toBe("2026-11-14T01:30");
		expect(fromWibInput("2026-11-14T01:30")).toEqual(date);
	});

	it("round-trips a value near midnight", () => {
		expect(toWibInput(fromWibInput("2026-11-14T00:00"))).toBe("2026-11-14T00:00");
		expect(toWibInput(fromWibInput("2026-11-13T23:59"))).toBe("2026-11-13T23:59");
	});

	it("treats an empty input as no date", () => {
		expect(fromWibInput("")).toBeNull();
		expect(toWibInput(null)).toBe("");
	});
});
