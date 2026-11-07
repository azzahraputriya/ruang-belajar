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

const TIME = new Intl.DateTimeFormat("id-ID", {
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "Asia/Jakarta",
});

// "14.02".
export const formatTime = (date: Date) => TIME.format(date);

// "Sab, 14 Nov 14.02".
export const formatDayTime = (date: Date) => `${formatDay(date)} ${formatTime(date)}`;

// "14.02" today, "Sab, 14 Nov 14.02" on any other WIB day, so an old save never reads as today's.
export const formatSaved = (date: Date, now = new Date()) =>
	formatDay(date) === formatDay(now) ? formatTime(date) : formatDayTime(date);

// The "YYYY-MM-DDTHH:mm" an <input type="datetime-local"> wants, as a WIB wall-clock time.
export function toWibInput(date: Date | null) {
	if (!date) return "";
	return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

// Reads a datetime-local value as WIB. An empty input means no date.
export function fromWibInput(value: string) {
	return value ? new Date(`${value}:00+07:00`) : null;
}
