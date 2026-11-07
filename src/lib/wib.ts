// Owns: showing and editing dates in WIB (Asia/Jakarta), whatever the server's or browser's own timezone. Not here: which dates a module has (src/db/content-schema.ts).

// WIB has no daylight saving, so a fixed +7h offset is exact for the input helpers.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// One zone for the server render and the browser, so the two never disagree on the day.
const DAY = new Intl.DateTimeFormat("id-ID", {
	weekday: "short",
	day: "numeric",
	month: "short",
	timeZone: "Asia/Jakarta",
});

// "Sab, 14 Nov".
export const formatDay = (date: Date) => DAY.format(date);

// The "YYYY-MM-DDTHH:mm" an <input type="datetime-local"> wants, as a WIB wall-clock time.
export function toWibInput(date: Date | null) {
	if (!date) return "";
	return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

// Reads a datetime-local value as WIB. An empty input means no date.
export function fromWibInput(value: string) {
	return value ? new Date(`${value}:00+07:00`) : null;
}
