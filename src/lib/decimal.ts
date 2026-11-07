// Owns: reading and writing decimal numbers the Indonesian way, with a comma ("19,6"), for answer and key inputs. Not here: grading numbers (src/server/question-kinds.ts).

// A dot works too, so a student who types "19.6" isn't refused. No thousands separators: "1.234,5" is refused
// rather than guessed at. Exponents are allowed ("6,674e-11"), because formatDecimal writes very small and very
// large numbers that way and a teacher must be able to save a key back unchanged.
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/iu;

// Undefined when the text isn't a plain decimal number, including when it's empty, and when an exponent
// overflows to Infinity ("1e999"), which the server refuses.
export function parseDecimal(text: string) {
	const plain = text.trim().replace(",", ".");
	if (!DECIMAL.test(plain)) return undefined;
	const value = Number(plain);
	return Number.isFinite(value) ? value : undefined;
}

export const formatDecimal = (value: number) => String(value).replace(".", ",");
