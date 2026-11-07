// Owns: tests for the comma-decimal helpers. Not here: the inputs that use them.

import { describe, expect, it } from "vitest";
import { formatDecimal, parseDecimal } from "#/lib/decimal";

describe("decimals", () => {
	it("reads a comma or a dot as the decimal mark", () => {
		expect(parseDecimal("19,6")).toBe(19.6);
		expect(parseDecimal(" 19.6 ")).toBe(19.6);
		expect(parseDecimal("-0,5")).toBe(-0.5);
		expect(parseDecimal(",5")).toBe(0.5);
		expect(parseDecimal("20")).toBe(20);
		expect(parseDecimal("6,674e-11")).toBe(6.674e-11);
	});

	it("refuses anything that isn't one plain number", () => {
		for (const text of ["", " ", "-", "abc", "1.234,5", "1,2,3", "1e", "0x10", "Infinity"]) {
			expect({ text, parsed: parseDecimal(text) }).toEqual({ text, parsed: undefined });
		}
	});

	it("writes with a comma", () => {
		expect(formatDecimal(19.6)).toBe("19,6");
		expect(formatDecimal(70)).toBe("70");
		for (const n of [1e-7, 6.674e-11, 1e21]) expect(parseDecimal(formatDecimal(n))).toBe(n);
	});
});
