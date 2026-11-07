// Owns: the error a refused server result becomes (thrown by orThrow in src/server/module-fns.ts), and picking the message for it, so one mutation error covers refusals and network failures. Not here: the messages themselves (each screen keeps a map typed by its own reasons).

export class Refused extends Error {
	constructor(readonly reason: string) {
		super(`Server refused: ${reason}`);
	}
}

// `messages` is typed by the caller as Record<its reasons, string>, so a new reason fails to compile there.
export function refusalMessage(
	error: Error | null,
	messages: Partial<Record<string, string>>,
	fallback: string,
) {
	if (!error) return "";
	return (error instanceof Refused && messages[error.reason]) || fallback;
}
