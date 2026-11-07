// Owns: turning a link a teacher pastes into the address an embed step frames. Not here: the embed step's view (src/components/step-kinds-ui.tsx).

const YOUTUBE_ID = /^[\w-]{11}$/;

function youtubeId(url: URL) {
	const host = url.hostname.replace(/^(www|m)\./, "");
	if (host === "youtu.be") return url.pathname.slice(1);
	if (host !== "youtube.com") return undefined;
	if (url.pathname === "/watch") return url.searchParams.get("v") ?? undefined;
	const [, section, id] = url.pathname.split("/");
	return section === "shorts" || section === "embed" || section === "live" ? id : undefined;
}

// YouTube writes a start time as "95", "95s", or "1m35s". Anything else is dropped.
function startSeconds(url: URL) {
	const raw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
	const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
	if (!raw || !match) return 0;
	const [, h = "0", m = "0", s = "0"] = match;
	return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// YouTube refuses to be framed from its watch page, so those links become the privacy-friendly embed.
// Every other site is framed as given. Many refuse too, which is why the view also links out.
export function embedSrc(raw: string) {
	// Not URL.parse: older phones lack it.
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return raw;
	}
	const id = youtubeId(url);
	if (!id || !YOUTUBE_ID.test(id)) return raw;
	const start = startSeconds(url);
	return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`;
}
