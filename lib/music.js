import { c as BilibiliMusicProvider, d as isPlayableAudioUrl, f as normalizeDuration, h as fetchJson, l as extractBvFromText, m as requirePlayableUrl, o as updateMusicCookie, p as providerError, t as Config, u as formatArtists } from "./config.js";
import { isHiraAppEnabled } from "./apps/runtime.js";
import { c as logCardRenderFailure, l as renderCardImage, o as buildStatusCardHtml } from "./cardRender.js";
import { f as resolveResolverRedirectUrl, h as downloadFile, i as replyPlainText, m as runFfmpeg, n as replyMusicList, o as replyText, r as replyMusicPlayable, s as replyVoiceFileOrAudio } from "./message.js";
import { i as getTempRoot, r as ensureTempDir } from "./temp.js";
import karin, { common, logger, segment } from "node-karin";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import fs$1 from "node:fs/promises";
import { encode, getWavFileInfo, isSilk, isWav } from "silk-wasm";
//#region src/music/commandParser.ts
const sourceAliases$1 = [
	[/^(?:网易云?|163)$/i, "netease"],
	[/^(?:QQ|扣扣|qqmusic)$/i, "qq"],
	[/^酷我$/i, "kuwo"],
	[/^酷狗$/i, "kugou"],
	[/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, "bilibili"]
];
const sourceWords = [
	"网易云?",
	"QQ",
	"qq",
	"扣扣",
	"酷我",
	"酷狗",
	"哔哩哔哩",
	"哔哩",
	"B站",
	"bilibili"
];
const actionWords$1 = [
	"点歌",
	"点播音乐",
	"点播",
	"播放",
	"放一首",
	"放首",
	"来一首",
	"来首"
];
const bilibiliUrlPattern = /https?:\/\/[^\s"'<>]*(?:bilibili\.com|b23\.tv|bili2233\.cn)[^\s"'<>]*/i;
const musicCookieCommandPattern = /^#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie)(?:\s|$))/i;
const normalizeSource = (word) => {
	if (!word) return void 0;
	const normalized = word.trim();
	return sourceAliases$1.find(([pattern]) => pattern.test(normalized))?.[1];
};
const stripHash = (msg) => msg.trim().replace(/^#/, "").trim();
/** 允许在命令前写音乐源, 与搜索命令保持一致的写法(`#QQ每日推荐`). */
const withOptionalSource = (body) => new RegExp(`^(?:多选)?(?:${sourceWords.join("|")})?(?:多选)?(?:${body})$`, "i");
const personalizedPattern = withOptionalSource("(每日推荐|每日30首|日推|个性电台|我的收藏|我喜欢的歌)\\s*(\\d+)?");
const parseMusicCommand = (message) => {
	const msg = message.trim();
	if (!msg) return { type: "none" };
	const bilibiliLink = msg.match(/^#?音乐\s+(.+)$/)?.[1]?.match(bilibiliUrlPattern)?.[0];
	if (bilibiliLink) return {
		type: "bilibiliLink",
		url: bilibiliLink
	};
	const select = msg.match(/^(?:#?(?:听|播放))?([1-9]\d*)$/);
	if (select) return {
		type: "select",
		index: Number(select[1])
	};
	if (/^#?下一页$/.test(msg)) return { type: "nextPage" };
	const lyrics = msg.match(/^#?歌词\s*([1-9]\d*)?$/);
	if (lyrics) return lyrics[1] ? {
		type: "lyrics",
		index: Number(lyrics[1])
	} : { type: "lyrics" };
	const voice = msg.match(/^#?(高清)?语音\s*([1-9]\d*)?$/);
	if (voice) return {
		type: "voice",
		...voice[2] ? { index: Number(voice[2]) } : {},
		...voice[1] ? { highQuality: true } : {}
	};
	if (/^#?下载音乐\s*(?:[1-9]\d*)?$/.test(msg)) return { type: "download" };
	const clean = stripHash(msg);
	if (musicCookieCommandPattern.test(clean)) return { type: "none" };
	const personalized = clean.match(personalizedPattern);
	if (personalized) {
		const word = personalized[1];
		const page = personalized[2] ? Number(personalized[2]) : void 0;
		if (word === "个性电台") return { type: "radio" };
		if (word === "我的收藏" || word === "我喜欢的歌") return {
			type: "favorites",
			...page ? { page } : {}
		};
		return { type: "dailyRecommend" };
	}
	if (/^(?:来一首|来首|放一首|放首)歌$/.test(clean)) return { type: "random" };
	const sourcePattern = sourceWords.join("|");
	const actionPattern = actionWords$1.join("|");
	const search = clean.match(new RegExp(`^(多选)?(${sourcePattern})?(多选)?(?:${actionPattern})\\s*([\\s\\S]*)$`, "i"));
	if (!search) return { type: "none" };
	return {
		type: "search",
		keyword: search[4]?.trim() ?? "",
		source: normalizeSource(search[2]),
		listMode: Boolean(search[1] || search[3])
	};
};
//#endregion
//#region src/music/providers/aggregator.ts
const platformType = {
	qq: "qq",
	netease: "netease",
	kugou: "kugou",
	kuwo: "kuwo"
};
const aggregatorUrl = () => Config.music.api.aggregatorUrl?.trim() || "";
const isEnabled = () => Boolean(Config.music.api.aggregatorEnabled) && aggregatorUrl().startsWith("http");
/** 只认标题完全一致的命中，避免兜底搜出别的歌还照发 */
const normalizeText = (value) => value.toLowerCase().replace(/[\s\-_/（）()【】[\]·,，.。!！?？'"]/g, "");
/** 单次请求超时、兜底查询总预算、结果缓存：上游不稳，既别把命令拖死，也别把人家打爆 */
const requestTimeoutMs = 5e3;
const overallBudgetMs = 6e3;
const cacheTtlMs = 12e4;
const cache = /* @__PURE__ */ new Map();
const cacheKey = (type, keyword) => `${type}:${keyword.trim().toLowerCase()}`;
const request = async (keyword, type, page, requestJson, timeoutMs = requestTimeoutMs) => {
	const base = aggregatorUrl();
	if (!base) return [];
	const key = cacheKey(type, keyword);
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < cacheTtlMs) return cached.songs;
	const origin = new URL(base).origin;
	const data = await requestJson(base, {
		method: "POST",
		body: new URLSearchParams({
			input: keyword,
			filter: "name",
			type,
			page: String(page)
		}).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"X-Requested-With": "XMLHttpRequest",
			Origin: origin,
			Referer: base
		},
		timeoutMs,
		maxBytes: 512 * 1024
	});
	const songs = Array.isArray(data?.data) ? data.data : [];
	if (songs.length > 0) {
		cache.set(key, {
			at: Date.now(),
			songs
		});
		if (cache.size > 200) {
			const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
			if (oldest) cache.delete(oldest[0]);
		}
	}
	return songs;
};
const aggregatorSearch = async (source, keyword, page, pageSize, requestJson = fetchJson) => {
	const type = platformType[source];
	if (!type || !isEnabled()) return [];
	try {
		return (await request(keyword, type, page, requestJson)).filter((song) => isAudioUrl(song.url)).slice(0, pageSize).map((song) => ({
			id: String(song.songid ?? ""),
			source,
			title: song.title || "未知歌曲",
			artists: song.author ? [song.author] : [],
			coverUrl: song.pic || void 0,
			pageUrl: song.link || String(song.url),
			raw: {
				aggregator: true,
				aggregatorUrl: song.url
			}
		})).filter((item) => item.id && item.pageUrl);
	} catch {
		return [];
	}
};
const isAudioUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);
/** 拿音频直链：搜索结果自带就直接用，否则按「标题 + 歌手」再查一次并要求标题对得上 */
const aggregatorAudioUrl = async (item, requestJson = fetchJson) => {
	const cached = item.raw?.aggregatorUrl;
	if (isAudioUrl(cached)) return cached;
	const type = platformType[item.source];
	if (!type || !isEnabled()) return void 0;
	const keywords = [[item.title, ...item.artists].filter(Boolean).join(" "), item.title].filter((keyword, index, list) => keyword && list.indexOf(keyword) === index);
	const targetTitle = normalizeText(item.title);
	const targetArtists = item.artists.map(normalizeText).filter(Boolean);
	const sameArtist = (song) => {
		const author = normalizeText(song.author || "");
		return Boolean(author) && targetArtists.some((artist) => artist && (author.includes(artist) || artist.includes(author)));
	};
	const startedAt = Date.now();
	const withinBudget = () => Date.now() - startedAt < overallBudgetMs;
	const remainingBudgetTimeout = () => Math.max(1e3, Math.min(requestTimeoutMs, overallBudgetMs - (Date.now() - startedAt)));
	for (const keyword of keywords) for (let attempt = 1; attempt <= 2 && withinBudget(); attempt += 1) try {
		const usable = (await request(keyword, type, 1, requestJson, remainingBudgetTimeout())).filter((song) => isAudioUrl(song.url));
		const exact = usable.filter((song) => normalizeText(song.title || "") === targetTitle);
		const prefixed = usable.filter((song) => normalizeText(song.title || "").startsWith(targetTitle));
		const candidates = exact.length > 0 ? exact : prefixed;
		if (candidates.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, 120));
			continue;
		}
		return (candidates.find(sameArtist) ?? candidates[0]).url;
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};
//#endregion
//#region src/music/providers/kugou.ts
var KugouProvider = class {
	source = "kugou";
	requestJson;
	constructor(options = {}) {
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	async search(keyword, page, pageSize) {
		const url = `https://mobiles.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}&showtype=1`;
		let data;
		try {
			data = await this.requestJson(url);
		} catch (error) {
			const aggregated = await aggregatorSearch("kugou", keyword, page, pageSize, this.requestJson).catch(() => []);
			if (aggregated.length > 0) return aggregated;
			throw providerError("酷狗", error);
		}
		const items = (data.data?.info ?? []).map((item) => ({
			id: item.hash,
			source: "kugou",
			title: item.songname || item.filename || "未知歌曲",
			artists: item.singername ? [item.singername] : [],
			durationSeconds: normalizeDuration(item.duration),
			coverUrl: item.imgurl?.replace("/{size}", ""),
			pageUrl: `https://www.kugou.com/song/#hash=${item.hash}`,
			raw: item
		}));
		if (items.length > 0) return items;
		return aggregatorSearch("kugou", keyword, page, pageSize, this.requestJson);
	}
	async getPlayable(item) {
		let data;
		try {
			data = await this.requestJson(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`);
		} catch {
			data = void 0;
		}
		if (data?.url && /^https?:/i.test(data.url)) return {
			item: {
				...item,
				title: data.fileName && !data.fileName.includes(" - ") ? data.fileName : item.title
			},
			audioUrl: requirePlayableUrl(data.url)
		};
		const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson);
		if (aggregatedUrl) return {
			item,
			audioUrl: aggregatedUrl
		};
		throw new Error(`酷狗：未获取到《${item.title}》的可播放链接（该歌曲可能已下架或需要会员）`);
	}
	async getLyrics(item) {
		return (await this.requestJson(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`)).lyrics?.trim() || void 0;
	}
};
//#endregion
//#region src/music/providers/kuwo.ts
var KuwoProvider = class {
	source = "kuwo";
	requestJson;
	constructor(options = {}) {
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	async search(keyword, page, pageSize) {
		const url = `https://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${pageSize}&httpsStatus=1`;
		let data;
		try {
			data = await this.requestJson(url, { headers: { Referer: "https://www.kuwo.cn/search/list" } });
		} catch (error) {
			const aggregated = await aggregatorSearch("kuwo", keyword, page, pageSize, this.requestJson).catch(() => []);
			if (aggregated.length > 0) return aggregated;
			throw providerError("酷我", error);
		}
		const items = (data.data?.list ?? []).map((item) => ({
			id: String(item.rid),
			source: "kuwo",
			title: item.name,
			artists: item.artist ? [item.artist] : [],
			album: item.album,
			durationSeconds: normalizeDuration(item.duration),
			coverUrl: item.pic,
			pageUrl: `https://www.kuwo.cn/play_detail/${item.rid}`,
			raw: item
		}));
		if (items.length > 0) return items;
		return aggregatorSearch("kuwo", keyword, page, pageSize, this.requestJson);
	}
	async getPlayable(item) {
		let audioUrl;
		try {
			const data = await this.requestJson(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${encodeURIComponent(item.id)}&type=convert_url&httpsStatus=1&reqId=${crypto.randomUUID()}`);
			audioUrl = typeof data.data === "string" ? data.data : data.data?.url;
		} catch {}
		if (!audioUrl?.trim()) {
			const legacyUrl = `http://antiserver.kuwo.cn/anti.s?useless=/resource/&format=mp3&rid=${encodeURIComponent(item.id)}&response=res&type=convert_url3&br=128kmp3`;
			try {
				audioUrl = (await this.requestJson(legacyUrl)).url;
			} catch {
				audioUrl = void 0;
			}
		}
		if (audioUrl?.trim()) return {
			item,
			audioUrl: requirePlayableUrl(audioUrl)
		};
		const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson);
		if (aggregatedUrl) return {
			item,
			audioUrl: aggregatedUrl
		};
		throw new Error(`酷我：未获取到《${item.title}》的可播放链接（该歌曲可能已下架或需要会员）`);
	}
	async getLyrics(item) {
		const lines = (await this.requestJson(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(item.id)}`)).data?.lrclist?.map((line) => line.lineLyric).filter(Boolean) ?? [];
		return lines.length > 0 ? lines.join("\n") : void 0;
	}
};
//#endregion
//#region src/music/providers/netease.ts
const isOfficialNeteaseApiBase = (baseUrl) => {
	try {
		const url = new URL(baseUrl);
		return url.hostname === "music.163.com" && url.pathname.replace(/\/$/, "") === "/api";
	} catch {
		return false;
	}
};
var NeteaseProvider = class {
	source = "netease";
	baseUrl;
	cookie;
	level;
	requestJson;
	constructor(options) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.cookie = options.cookie ?? "";
		this.level = options.highQuality ? "lossless" : "exhigh";
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	async search(keyword, page, pageSize) {
		try {
			return await this.searchUnsafe(keyword, page, pageSize);
		} catch (error) {
			throw providerError("网易云", error);
		}
	}
	async searchUnsafe(keyword, page, pageSize) {
		const offset = Math.max(0, page - 1) * pageSize;
		try {
			if (isOfficialNeteaseApiBase(this.baseUrl)) {
				const items = ((await this.requestJson(`${this.baseUrl}/cloudsearch/pc`, {
					method: "POST",
					body: new URLSearchParams({
						offset: String(offset),
						limit: String(pageSize),
						type: "1",
						s: keyword
					}).toString(),
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Referer: "https://music.163.com/",
						...this.cookie ? { Cookie: this.cookie } : {}
					}
				})).result?.songs ?? []).map((song) => this.toItem(song));
				if (items.length > 0) return items;
			} else {
				const url = `${this.baseUrl}/cloudsearch?keywords=${encodeURIComponent(keyword)}&limit=${pageSize}&offset=${offset}`;
				const items = ((await this.requestJson(url, this.cookie ? { headers: { Cookie: this.cookie } } : {})).result?.songs ?? []).map((song) => this.toItem(song));
				if (items.length > 0) return items;
			}
		} catch {}
		return aggregatorSearch("netease", keyword, page, pageSize, this.requestJson);
	}
	async getPlayable(item) {
		const fallbackUrl = isOfficialNeteaseApiBase(this.baseUrl) ? `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(item.id)}` : void 0;
		if (this.cookie.includes("MUSIC_U=")) try {
			const request = buildNeteaseHighQualityRequest(item.id, this.level);
			const playable = (await this.requestJson(request.url, {
				method: "POST",
				body: request.body,
				headers: {
					Cookie: this.cookie,
					"Content-Type": "application/x-www-form-urlencoded"
				}
			})).data?.[0];
			if (playable?.url) return {
				item,
				audioUrl: playable.url,
				quality: playable.level
			};
		} catch {}
		const fee = Number(item.raw?.fee ?? 0);
		const fallbackUsable = fallbackUrl && (fee === 0 || await isPlayableAudioUrl(fallbackUrl));
		if (fallbackUrl && fallbackUsable) return {
			item,
			audioUrl: fallbackUrl
		};
		const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson);
		if (aggregatedUrl && await isPlayableAudioUrl(aggregatedUrl)) return {
			item,
			audioUrl: aggregatedUrl
		};
		if (fallbackUrl) {
			logger.warn(`[Hira-网易云] 直链校验未通过，仅平台卡片可用 曲目=${item.title} id=${item.id}`);
			return {
				item,
				audioUrl: fallbackUrl
			};
		}
		const url = `${this.baseUrl}/song/url/v1?id=${encodeURIComponent(item.id)}&level=${this.level}`;
		let data;
		try {
			data = await this.requestJson(url, this.cookie ? { headers: { Cookie: this.cookie } } : {});
		} catch (error) {
			throw providerError("网易云", error);
		}
		const playable = data.data?.[0];
		if (!playable?.url?.trim()) throw new Error(`网易云：未获取到《${item.title}》的可播放链接（可能需要会员或该歌曲已下架）`);
		return {
			item,
			audioUrl: requirePlayableUrl(playable.url),
			quality: playable.level
		};
	}
	async getLyrics(item) {
		const data = await this.requestJson(`${this.baseUrl}/lyric?id=${encodeURIComponent(item.id)}`);
		return [data.lrc?.lyric, data.tlyric?.lyric].filter((value) => Boolean(value?.trim()));
	}
	async checkCookie() {
		if (!this.cookie.trim()) return {
			ok: false,
			message: "未配置 Cookie"
		};
		return normalizeNeteaseCookieStatus(await this.requestJson("https://interface.music.163.com/api/nuser/account/get", { headers: { Cookie: this.cookie } }));
	}
	toItem(song) {
		const artists = song.artists ?? song.ar ?? [];
		const album = song.album ?? song.al;
		return {
			id: String(song.id),
			source: "netease",
			title: song.name,
			artists: artists.map((item) => item.name || "").filter(Boolean),
			album: album?.name,
			durationSeconds: normalizeDuration(song.duration ?? song.dt),
			coverUrl: album?.picUrl,
			pageUrl: `https://music.163.com/#/song?id=${song.id}`,
			raw: song
		};
	}
};
const buildNeteaseHighQualityRequest = (id, level = "exhigh") => ({
	url: "https://interface3.music.163.com/api/song/enhance/player/url/v1",
	body: new URLSearchParams({
		ids: `[${id}]`,
		level,
		encodeType: "mp3"
	}).toString()
});
const normalizeNeteaseCookieStatus = (payload) => {
	const data = payload && typeof payload === "object" ? payload : {};
	if (data.code === 200 && data.profile?.nickname) return {
		ok: true,
		message: data.profile.nickname,
		...data.account ? { vip: Number(data.account.vipType ?? 0) !== 0 } : {}
	};
	return {
		ok: false,
		message: "Cookie 失效或未登录"
	};
};
//#endregion
//#region src/music/providers/qq.ts
const musicuUrl = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const profileUrl = "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?format=json";
/** 旧版搜索接口：不需要登录态，musicu 桌面搜索未登录时返回 2001 空列表，用它兜底 */
const legacySearchUrl = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
/**
* 直链缓存：vkey 有有效期（数小时），10 分钟内复用是安全的。
* 同一首歌被反复点（或列表里来回选）时省掉一次 vkey + 聚合查询。
*/
const playableCache = /* @__PURE__ */ new Map();
const playableCacheTtlMs = 10 * 6e4;
const playableCacheMax = 300;
const playableCacheKey = (item) => {
	const aggregator = item.raw?.aggregatorUrl;
	return `${item.id}:${aggregator ? "aggregator" : "native"}`;
};
const readPlayableCache = (item) => {
	const entry = playableCache.get(playableCacheKey(item));
	if (!entry) return void 0;
	if (Date.now() - entry.at > playableCacheTtlMs) {
		playableCache.delete(playableCacheKey(item));
		return;
	}
	return entry.audioUrl;
};
const writePlayableCache = (item, audioUrl) => {
	playableCache.set(playableCacheKey(item), {
		at: Date.now(),
		audioUrl
	});
	if (playableCache.size > playableCacheMax) {
		const oldest = [...playableCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
		if (oldest) playableCache.delete(oldest[0]);
	}
};
const asRecord$1 = (value) => {
	return value && typeof value === "object" ? value : {};
};
/** 搜索结果、每日推荐、电台、收藏的歌曲结构一致, 共用同一份映射. */
const normalizeQQTracks = (tracks) => {
	return (tracks ?? []).map((item) => {
		const mid = item.mid || item.songmid || String(item.id ?? item.songid ?? "");
		const albumMid = item.album?.pmid || item.album?.mid || "";
		return {
			id: mid,
			source: "qq",
			title: item.name || item.songname || item.title || "未知歌曲",
			artists: (item.singer ?? []).map((singer) => singer.name || "").filter(Boolean),
			album: item.album?.name,
			durationSeconds: normalizeDuration(item.interval),
			coverUrl: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : void 0,
			pageUrl: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
			raw: item
		};
	}).filter((item) => item.id);
};
/** 旧搜索接口的返回结构：data.song.list[]，字段是 songmid/songname/singer[].name/albummid/interval */
const normalizeQQClientSearchResult = (payload) => {
	const song = asRecord$1(asRecord$1(asRecord$1(payload).data).song);
	return (Array.isArray(song.list) ? song.list : []).map((item) => {
		const mid = (item.songmid || "").trim();
		return {
			id: mid,
			source: "qq",
			title: item.songname || "未知歌曲",
			artists: (item.singer ?? []).map((singer) => singer.name || "").filter(Boolean),
			album: item.albumname,
			durationSeconds: normalizeDuration(item.interval),
			coverUrl: item.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${item.albummid}.jpg` : void 0,
			pageUrl: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
			raw: item
		};
	}).filter((item) => item.id);
};
/** 官方桌面搜索的返回结构：req_1.data.body.song.list[] */
const normalizeQQSearchResult = (payload) => {
	const song = asRecord$1(asRecord$1(asRecord$1(asRecord$1(asRecord$1(payload).req_1).data).body).song);
	return normalizeQQTracks(Array.isArray(song.list) ? song.list : []);
};
const pickQQPlayableUrl = (payload) => {
	const data = asRecord$1(asRecord$1(asRecord$1(payload).req_0).data);
	const sip = Array.isArray(data.sip) ? String(data.sip[0] ?? "") : "";
	const purl = (Array.isArray(data.midurlinfo) ? data.midurlinfo : []).find((item) => item.purl)?.purl;
	if (!purl) return void 0;
	if (/^https?:\/\//i.test(purl)) return purl;
	return `${sip}${purl}`;
};
const decodeQQLyric = (value) => {
	if (!value) return void 0;
	return Buffer.from(value, "base64").toString("utf8");
};
const normalizeQQCookieStatus = (payload, vip) => {
	const data = asRecord$1(payload);
	const nick = data.data?.creator?.nick?.trim();
	if (data.code === 0 && nick) return {
		ok: true,
		message: nick,
		...vip === void 0 ? {} : { vip }
	};
	return {
		ok: false,
		message: "Cookie 失效或未登录"
	};
};
const qqCookieValue = (cookie, keys) => {
	for (const part of cookie.split(";")) {
		const [key, ...rest] = part.split("=");
		if (keys.includes(key.trim().toLowerCase())) return rest.join("=").trim();
	}
};
/** QQ 音乐个性化接口需要 uin; 微信登录的 Cookie 只有 wxuin. */
const parseQQCookieUin = (cookie) => qqCookieValue(cookie, ["uin", "wxuin"]);
const qqCookieMusicKey = (cookie) => qqCookieValue(cookie, ["qm_keyst", "qqmusic_key"]);
const buildQQSearchBody = (keyword, page, pageSize) => ({ req_1: {
	method: "DoSearchForQQMusicDesktop",
	module: "music.search.SearchCgiService",
	param: {
		query: keyword,
		page_num: page,
		num_per_page: pageSize,
		search_type: 0
	}
} });
/** 云崽的音质阶梯: 320mp3 > 192ogg > 128mp3 > 96aac, 请求时按可用档位一次全带上. */
const qqQualityTiers = [
	[
		"size_320mp3",
		"M800",
		"mp3"
	],
	[
		"size_192ogg",
		"O600",
		"ogg"
	],
	[
		"size_128mp3",
		"M500",
		"mp3"
	],
	[
		"size_96aac",
		"C400",
		"m4a"
	]
];
/**
* 文件名必须用 file.media_mid(部分歌曲与 songmid 不同), 否则 vkey 返回空 purl.
* 档位信息缺失时(例如只有搜索结果 mid)退回 320mp3 单档.
*/
const buildQQVkeyFilenames = (songmid, file) => {
	const mediaMid = file?.media_mid?.trim() || songmid;
	const filenames = qqQualityTiers.filter(([sizeKey]) => Number(file?.[sizeKey] ?? 0) > 0).map(([, prefix, ext]) => `${prefix}${mediaMid}.${ext}`);
	return filenames.length > 0 ? filenames : [`M800${mediaMid}.mp3`];
};
const buildQQVkeyBody = (songmid, file) => {
	const filenames = buildQQVkeyFilenames(songmid, file);
	return { req_0: {
		module: "vkey.GetVkeyServer",
		method: "CgiGetVkey",
		param: {
			guid: "10000",
			songmid: filenames.map(() => songmid),
			songtype: filenames.map(() => 0),
			uin: "0",
			loginflag: 1,
			platform: "20",
			filename: filenames
		}
	} };
};
const qqSongmidPattern = /^[0-9A-Za-z]{14}$/;
const qqShareSalt = "q;z(&l~sdf2!nK";
const buildLegacyQQShareMusicUrl = (songmid, uin = "0") => {
	if (!qqSongmidPattern.test(songmid)) return void 0;
	return `http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songid=&songmid=${songmid}&songtype=1&fromtag=50&uin=${uin}&code=${crypto.createHash("md5").update(`${songmid}${qqShareSalt}`).digest("hex").slice(0, 5).toUpperCase()}`;
};
var QQProvider = class {
	source = "qq";
	tempApi;
	cookie;
	requestJson;
	constructor(options) {
		this.tempApi = options.tempApi ?? "";
		this.cookie = options.cookie ?? "";
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	/** 官方桌面搜索：未登录态下可能返回 code 2001 空列表 */
	async searchOfficial(keyword, page, pageSize) {
		try {
			return normalizeQQSearchResult(await this.requestJson(musicuUrl, {
				method: "POST",
				body: JSON.stringify(buildQQSearchBody(keyword, page, pageSize)),
				headers: {
					"Content-Type": "application/json",
					Referer: "https://y.qq.com/",
					...this.cookie ? { Cookie: this.cookie } : {}
				}
			}));
		} catch {
			return [];
		}
	}
	/** 旧搜索接口：不需要登录态，官方接口拿不到结果时兜底 */
	async searchLegacy(keyword, page, pageSize) {
		try {
			const url = `${legacySearchUrl}?w=${encodeURIComponent(keyword)}&format=json&n=${pageSize}&p=${page}&cr=1&g_tk=5381`;
			return normalizeQQClientSearchResult(await this.requestJson(url, { headers: {
				Referer: "https://y.qq.com/",
				...this.cookie ? { Cookie: this.cookie } : {}
			} }));
		} catch {
			return [];
		}
	}
	async search(keyword, page, pageSize) {
		const [official, legacy] = await Promise.all([this.searchOfficial(keyword, page, pageSize), this.searchLegacy(keyword, page, pageSize)]);
		if (official.length > 0) return official;
		if (legacy.length > 0) return legacy;
		const aggregated = await aggregatorSearch("qq", keyword, page, pageSize, this.requestJson);
		if (aggregated.length > 0) return aggregated;
		throw new Error("QQ音乐搜索暂时不可用，可以试试「#网易点歌 歌名」或稍后再试");
	}
	async resolvePlayable(item) {
		const track = item.raw;
		try {
			const audioUrl = pickQQPlayableUrl(await this.requestJson(musicuUrl, {
				method: "POST",
				body: JSON.stringify(buildQQVkeyBody(item.id, track?.file)),
				headers: {
					"Content-Type": "application/json",
					Referer: "https://y.qq.com/",
					...this.cookie ? { Cookie: this.cookie } : {}
				}
			}));
			if (audioUrl) return {
				item,
				audioUrl
			};
		} catch {}
		const aggregatedUrl = await aggregatorAudioUrl(item, this.requestJson);
		if (aggregatedUrl) return {
			item,
			audioUrl: aggregatedUrl
		};
		const legacyUrl = buildLegacyQQShareMusicUrl(item.id);
		if (legacyUrl) return {
			item,
			audioUrl: legacyUrl
		};
		if (!this.tempApi) throw new Error(`QQ音乐：未获取到《${item.title}》的可播放链接（可能需要配置 Cookie 或该歌曲需付费）`);
		const raw = item.raw;
		const keyword = raw?.keyword || item.title;
		const index = raw?.index || 1;
		const data = await fetchJson(this.tempApi.replace("{keyword}", encodeURIComponent(keyword)).replace("{index}", String(index)));
		return {
			item,
			audioUrl: requirePlayableUrl(data.music_url || data.url || data.data?.music_url || data.data?.url)
		};
	}
	async getPlayable(item) {
		const cached = readPlayableCache(item);
		if (cached) return {
			item,
			audioUrl: cached
		};
		const playable = await this.resolvePlayable(item);
		writePlayableCache(item, playable.audioUrl);
		return playable;
	}
	async getLyrics(item) {
		const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(item.id)}&format=json&nobase64=0`;
		const data = await this.requestJson(url, { headers: {
			Referer: "https://y.qq.com/",
			...this.cookie ? { Cookie: this.cookie } : {}
		} });
		return [decodeQQLyric(data.lyric), decodeQQLyric(data.trans)].filter((value) => Boolean(value?.trim()));
	}
	async checkCookie() {
		if (!this.cookie.trim()) return {
			ok: false,
			message: "未配置 Cookie"
		};
		const data = await this.requestJson(profileUrl, { headers: {
			Referer: "https://y.qq.com/",
			Cookie: this.cookie
		} });
		const uin = parseQQCookieUin(this.cookie);
		return normalizeQQCookieStatus(data, uin ? await this.isVip(uin) : void 0);
	}
	/** QQ 音乐 VIP 判定, 失败按非 VIP 处理(状态回显不应因 VIP 查询失败而报错). */
	async isVip(uin) {
		try {
			const data = await this.requestJson(musicuUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...this.cookie ? { Cookie: this.cookie } : {}
				},
				body: JSON.stringify({
					comm: {
						cv: 4747474,
						ct: 24,
						format: "json",
						inCharset: "utf-8",
						outCharset: "utf-8",
						notice: 0,
						platform: "yqq.json",
						needNewCode: 1,
						uin: 0,
						g_tk_new_20200303: 5381,
						g_tk: 5381
					},
					req_0: {
						module: "userInfo.VipQueryServer",
						method: "SRFVipQuery_V2",
						param: { uin_list: [uin] }
					}
				})
			});
			if (String(data.req_0?.code ?? "0") !== "0") return false;
			const info = data.req_0?.data?.infoMap?.[uin];
			if (!info) return false;
			return [
				info.iVipFlag,
				info.iSuperVip,
				info.iNewVip,
				info.iNewSuperVip
			].some((flag) => flag === 1);
		} catch {
			return false;
		}
	}
	requirePersonalizedCookie(action) {
		if (!this.cookie.trim()) throw new Error(`QQ音乐：${action}需要先配置 Cookie（发送 #提交音乐ck 粘贴 QQ 音乐 Cookie）`);
		const uin = parseQQCookieUin(this.cookie);
		if (!uin) throw new Error(`QQ音乐：${action}的 Cookie 缺少 uin/wxuin，请重新获取完整 Cookie`);
		return uin;
	}
	async requestMusicu(req, uin) {
		return this.requestJson(musicuUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Referer: "https://y.qq.com/",
				...this.cookie ? { Cookie: this.cookie } : {}
			},
			body: JSON.stringify({
				comm: {
					g_tk: 5381,
					uin,
					format: "json",
					ct: 20,
					cv: 1803,
					platform: "wk_v17",
					guid: crypto.createHash("md5").update(String(Date.now())).digest("hex"),
					tmeLoginType: 2,
					psrf_qqunionid: "",
					authst: qqCookieMusicKey(this.cookie) ?? ""
				},
				...req
			})
		});
	}
	/** 云崽 dirid: 201=我喜欢, 202=每日推荐. */
	async getDissTracks(dirid, page, pageSize) {
		const uin = this.requirePersonalizedCookie(dirid === 202 ? "每日推荐" : "我的收藏");
		const data = await this.requestMusicu({ req_0: {
			module: "srf_diss_info.DissInfoServer",
			method: "CgiGetDiss",
			param: {
				disstid: 0,
				dirid,
				onlysonglist: 0,
				song_begin: (Math.max(page, 1) - 1) * pageSize,
				song_num: pageSize,
				userinfo: 1,
				pic_dpi: 800,
				orderlist: 1
			}
		} }, uin);
		if (String(data.req_0?.code ?? "0") !== "0") throw new Error(`QQ音乐：${dirid === 202 ? "每日推荐" : "收藏"}获取失败（登录态可能已失效）`);
		return normalizeQQTracks(data.req_0?.data?.songlist);
	}
	async getPersonalized(kind, options) {
		const page = options?.page ?? 1;
		const pageSize = options?.pageSize ?? 20;
		if (kind === "favorites") return this.getDissTracks(201, page, pageSize);
		if (kind === "dailyRecommend") return this.getDissTracks(202, page, pageSize);
		if (kind === "radio") {
			const uin = this.requirePersonalizedCookie("个性电台");
			const data = await this.requestMusicu({ req_0: {
				method: "get_radio_track",
				module: "pc_track_radio_svr",
				param: {
					id: 99,
					num: pageSize
				}
			} }, uin);
			if (String(data.req_0?.code ?? "0") !== "0") throw new Error("QQ音乐：个性电台获取失败（登录态可能已失效）");
			return normalizeQQTracks(data.req_0?.data?.tracks);
		}
		const uin = this.requirePersonalizedCookie("每日推荐");
		const feed = await this.requestMusicu({ req_0: {
			module: "recommend.RecommendFeedServer",
			method: "get_recommend_feed",
			param: {
				direction: 1,
				page: 1,
				v_cache: [],
				v_uniq: [],
				s_num: 0
			}
		} }, uin);
		if (String(feed.req_0?.code ?? "0") !== "0") throw new Error("QQ音乐：获取推荐歌曲失败，请重试");
		const ids = [];
		for (const shelf of feed.req_0?.data?.v_shelf ?? []) {
			if (shelf.style !== 1) continue;
			for (const niche of shelf.v_niche ?? []) for (const card of niche.v_card ?? []) if (card.id !== void 0 && ids.length < pageSize) ids.push(String(card.id));
		}
		if (ids.length === 0) throw new Error("QQ音乐：获取推荐歌曲失败，请重试");
		const tracks = normalizeQQTracks((await this.requestMusicu({ req_0: {
			module: "track_info.UniformRuleCtrlServer",
			method: "GetTrackInfo",
			param: {
				ids: ids.map(Number),
				types: ids.map(() => 200)
			}
		} }, uin)).req_0?.data?.tracks);
		if (tracks.length === 0) throw new Error("QQ音乐：获取推荐歌曲失败，请重试");
		return [tracks[Math.floor(Math.random() * tracks.length)]];
	}
};
//#endregion
//#region src/music/providers/index.ts
const createMusicProviders = () => {
	const music = Config.music;
	const providers = /* @__PURE__ */ new Map();
	providers.set("netease", new NeteaseProvider({
		baseUrl: music.api.neteaseBaseUrl,
		cookie: music.cookies.netease,
		highQuality: music.highQuality
	}));
	providers.set("qq", new QQProvider({
		tempApi: music.api.qqTempApi,
		cookie: music.cookies.qq
	}));
	providers.set("kuwo", new KuwoProvider());
	providers.set("kugou", new KugouProvider());
	providers.set("bilibili", new BilibiliMusicProvider({
		cookie: music.cookies.bilibili,
		appKey: music.bilibili.appKey,
		appSecret: music.bilibili.appSecret
	}));
	return providers;
};
//#endregion
//#region src/music/quotedCard.ts
const asRecord = (value) => {
	return value && typeof value === "object" ? value : void 0;
};
/**
* 从消息元素里取引用段的 messageId: 引用段只带 id, 正文要再用 getMsg 取一次.
* 与 apps/translate 的读取方式一致.
*/
const findQuotedMessageId = (elements) => {
	if (!Array.isArray(elements)) return void 0;
	for (const el of elements) {
		if (!el || typeof el !== "object") continue;
		const record = el;
		if (record.type === "reply" && typeof record.messageId === "string" && record.messageId) return record.messageId;
	}
};
/** getMsg 的正文在 elements; 旧适配器只给 message. */
const readMessageElements = (message) => {
	const record = asRecord(message);
	if (!record) return void 0;
	for (const key of ["elements", "message"]) {
		const value = record[key];
		if (Array.isArray(value)) return value;
	}
};
/**
* 解析 json 段的音乐卡片. 云崽只看 `view === 'music'` 的 `meta.music`.
* 这里接受 data 为字符串或对象, 并容忍跳转链接缺失.
*/
const extractQuotedMusicCard = (elements) => {
	if (!Array.isArray(elements)) return void 0;
	for (const el of elements) {
		const record = asRecord(el);
		if (record?.type !== "json") continue;
		const raw = record.data;
		let payload = raw;
		if (typeof raw === "string") try {
			payload = JSON.parse(raw);
		} catch {
			continue;
		}
		const card = asRecord(payload);
		const music = asRecord(asRecord(card?.meta)?.music);
		const musicUrl = typeof music?.musicUrl === "string" ? music.musicUrl : "";
		if (card?.view !== "music" || !musicUrl.trim()) continue;
		return {
			title: typeof music?.title === "string" && music.title.trim() ? music.title : "未知歌曲",
			desc: typeof music?.desc === "string" ? music.desc : "",
			musicUrl,
			...typeof music?.jumpUrl === "string" && music.jumpUrl ? { jumpUrl: music.jumpUrl } : {}
		};
	}
};
//#endregion
//#region src/music/selection.ts
const isBareNumericSelection = (message) => /^\s*[1-9]\d*\s*$/.test(message);
const shouldDeferSelection = (message, hasSession) => {
	return isBareNumericSelection(message) && !hasSession;
};
//#endregion
//#region src/music/session.ts
/** 内存中最多保留的会话数，超出后按 expiresAt 最旧淘汰，避免只增不减 */
const defaultMaxSessions = 500;
var MusicSessionStore = class {
	getTtlMs;
	now;
	maxSessions;
	onExpire;
	sessions = /* @__PURE__ */ new Map();
	constructor(options) {
		this.getTtlMs = options.getTtlMs ?? (() => options.ttlMs ?? 0);
		this.now = options.now ?? Date.now;
		this.maxSessions = Math.max(1, options.maxSessions ?? defaultMaxSessions);
		this.onExpire = options.onExpire;
	}
	/** 当前保留的会话数量，主要供容量/清扫观测 */
	get size() {
		return this.sessions.size;
	}
	set(key, items, meta) {
		this.sessions.set(key, {
			items: [...items],
			meta,
			expiresAt: this.now() + Math.max(0, this.getTtlMs()),
			startIndex: 1,
			listMessages: []
		});
		this.evictOverflow();
	}
	/**
	* 追加下一页并续期 TTL,返回新页的全局起始序号.
	* 会话缺失或已过期时返回 undefined.
	*/
	appendPage(key, items, page) {
		const session = this.takeIfAlive(key);
		if (!session) return void 0;
		const startIndex = session.startIndex + session.items.length;
		session.items.push(...items);
		session.meta = {
			...session.meta,
			page
		};
		session.expiresAt = this.now() + Math.max(0, this.getTtlMs());
		return {
			startIndex,
			items
		};
	}
	get(key) {
		return this.takeIfAlive(key);
	}
	/** 按全局序号(跨页连续)取歌,越界返回 undefined */
	select(key, oneBasedIndex) {
		const session = this.takeIfAlive(key);
		if (!session || oneBasedIndex < session.startIndex) return void 0;
		const item = session.items[oneBasedIndex - session.startIndex];
		if (!item) return void 0;
		session.lastSelected = item;
		return item;
	}
	getLastSelected(key) {
		return this.takeIfAlive(key)?.lastSelected;
	}
	/** 记录刚发出的列表消息,用于换歌/过期时整批撤回(翻页会保留旧页的 id) */
	addListMessage(key, target) {
		const session = this.takeIfAlive(key);
		if (!session) return;
		if (session.listMessages.some((item) => item.messageId === target.messageId)) return;
		session.listMessages.push(target);
	}
	/** 取出本会话所有待撤回的列表消息并清空(每条只撤一次) */
	takeListMessages(key) {
		const session = this.takeIfAlive(key);
		if (!session || session.listMessages.length === 0) return [];
		const targets = session.listMessages;
		session.listMessages = [];
		return targets;
	}
	/**
	* 主动清理所有已过期会话并返回清理条数.
	* 由定时器调用:否则过期会话只有在用户再次交互时才会被发现,
	* 列表卡片不会按时撤回,Map 也会随用户数无限增长.
	*/
	sweep() {
		let removed = 0;
		for (const [key, session] of this.sessions) {
			if (session.expiresAt > this.now()) continue;
			this.expire(key, session);
			removed += 1;
		}
		return removed;
	}
	takeIfAlive(key) {
		const session = this.sessions.get(key);
		if (!session) return void 0;
		if (session.expiresAt <= this.now()) {
			this.expire(key, session);
			return;
		}
		return session;
	}
	/**
	* 删除会话,列表消息可定位时触发一次过期回调.
	* takeIfAlive 与 sweep 共用,保证两条路径的撤回语义一致.
	*/
	expire(key, session) {
		this.sessions.delete(key);
		if (session.listMessages.length === 0) return;
		const targets = session.listMessages;
		session.listMessages = [];
		try {
			this.onExpire?.(targets);
		} catch {}
	}
	evictOverflow() {
		if (this.sessions.size <= this.maxSessions) return;
		this.sweep();
		if (this.sessions.size <= this.maxSessions) return;
		const overflow = this.sessions.size - this.maxSessions;
		const oldest = [...this.sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, overflow);
		for (const [key] of oldest) this.sessions.delete(key);
	}
};
//#endregion
//#region src/music/silk.ts
/**
* 把下载好的音频转成 QQ 语音端原生的 SILK.
* 已是 SILK 的文件直接落盘, 避免重复编码; 其它非 WAV 输入无法编码, 交给调用方降级.
* @returns 写出的 SILK 文件路径
*/
const encodeSilkFile = async (inputPath, outputPath) => {
	const input = await fs$1.readFile(inputPath);
	if (isSilk(input)) {
		await fs$1.writeFile(outputPath, input);
		return outputPath;
	}
	if (!isWav(input)) throw new Error("silk 编码需要 WAV 输入");
	const { sampleRate } = getWavFileInfo(input).fmt;
	const result = await encode(input, sampleRate);
	await fs$1.writeFile(outputPath, result.data);
	return outputPath;
};
//#endregion
//#region src/music/voice.ts
const buildVoiceTempPaths = (root = getTempRoot()) => {
	const dir = ensureTempDir(root, "music-voice");
	const base = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return {
		source: path.join(dir, `${base()}.audio`),
		wav: path.join(dir, `${base()}.wav`),
		silk: path.join(dir, `${base()}.silk`),
		/** silk 不可用时的 opus 兜底产物 */
		output: path.join(dir, `${base()}.ogg`)
	};
};
/** 语音展示标签, 占位文案与日志共用: `[歌名-歌手]`. */
const voiceFileLabel = (playable) => `[${playable.item.title}-${formatArtists(playable.item.artists)}]`;
/** 上传前占位文案: `开始上传[歌名-歌手]…`. */
const voiceUploadPlaceholder = (playable) => `开始上传${voiceFileLabel(playable)}…`;
/** 高清语音发送后的 PCQQ 兼容提示, 需引用发出. */
const pcqqVoiceWarning = (playable) => `${voiceFileLabel(playable)} 高清语音已发送, PCQQ 可能无法播放, 请用手机 QQ 收听.`;
/**
* 普通语音: 下载 → WAV(24k 单声道) → SILK.
* SILK 是 QQ 语音端原生格式, 发送后是真语音条(等价云崽 uploadRecord 的转码路径).
* silk-wasm 不可用时退回 opus ogg, 保证至少能发出语音.
*/
const transcodePlayableToVoice = async (playable, options = {}) => {
	const paths = buildVoiceTempPaths();
	try {
		await downloadFile({
			url: playable.audioUrl,
			output: paths.source,
			maxBytes: Config.runtime.maxAudioFileSizeBytes
		});
		try {
			await runFfmpeg({
				input: paths.source,
				output: paths.wav,
				format: "wav"
			});
			return await encodeSilkFile(paths.wav, paths.silk);
		} catch {
			await runFfmpeg({
				input: paths.source,
				output: paths.output,
				format: "voice",
				highQuality: options.highQuality
			});
			return paths.output;
		}
	} catch (error) {
		for (const file of [
			paths.wav,
			paths.silk,
			paths.output
		]) fs.rmSync(file, { force: true });
		throw error;
	} finally {
		fs.rmSync(paths.source, { force: true });
	}
};
/**
* 解析语音上行文件.
* - 高清 (`highQuality`): 返回 `undefined`, 由 `replyVoiceFileOrAudio` 直传原音质直链
*   (等价云崽 uploadRecord 的 `transcoding=false`); 直传失败由调用方降级到 SILK.
* - 普通语音: 转成 SILK 真语音条.
*
* 不变量: 高清才允许直传原音质; 普通语音必须转码成语音端原生格式.
* 失败时抛给调用方走直链兜底.
*/
const resolveVoiceFile = async (playable, options) => {
	if (options?.highQuality) return void 0;
	return transcodePlayableToVoice(playable, options);
};
//#endregion
//#region src/music/controller.ts
/** 撤回一条列表消息,失败静默(过期/无权限/已被撤都属正常). */
const recallListMessage = async (target) => {
	try {
		await karin.getBot(target.selfId)?.recallMsg(target.contact, target.messageId);
	} catch {}
};
/** 换歌/超时时整批撤回历史列表图,避免聊天区残留旧页码. */
const recallListMessages = async (targets) => {
	for (const target of targets) await recallListMessage(target);
};
const store = new MusicSessionStore({
	getTtlMs: () => Config.music.sessionTtlSeconds * 1e3,
	onExpire: (targets) => {
		recallListMessages(targets);
	}
});
/**
* 启动会话清理定时器并返回它(便于测试或热重载时清除).
* unref 让定时器不阻止进程退出,否则插件卸载后进程仍会因它驻留.
*/
const startSessionSweeper = (store, intervalMs = 6e4) => {
	const timer = setInterval(() => {
		store.sweep();
	}, intervalMs);
	timer.unref?.();
	return timer;
};
startSessionSweeper(store);
/** B站短链（b23.tv/bili2233.cn）和带追踪参数的链接先还原成含 BV 号的落地页。 */
const expandBilibiliLink = async (url) => {
	if (extractBvFromText(url)) return url;
	try {
		return await resolveResolverRedirectUrl(url);
	} catch {
		return url;
	}
};
/** 会话按人隔离:群聊 group_群_用户_bot,私聊 friend_用户_bot,保留 selfId 区分多 Bot. */
const sessionKey = (e) => {
	return `${e.isGroup ? `group_${e.contact.peer}` : "friend"}_${e.userId || e.contact.peer}_${e.selfId}`;
};
const providers = () => createMusicProviders();
const sourceName$1 = (source) => ({
	netease: "网易云",
	qq: "QQ音乐",
	kuwo: "酷我",
	kugou: "酷狗",
	bilibili: "哔哩哔哩"
})[source];
const getProvider = (source) => {
	const provider = providers().get(source);
	if (!provider) throw new Error(`未启用音乐源：${sourceName$1(source)}`);
	return provider;
};
const selectItem = (e, index) => {
	const key = sessionKey(e);
	if (index) return store.select(key, index);
	return store.getLastSelected(key) ?? store.select(key, 1);
};
const musicUsage = [
	"------点歌说明------",
	"格式：#点歌 歌名 / #多选点歌 歌名",
	"支持：QQ音乐、网易云、酷我、酷狗、哔哩哔哩",
	"示例：#QQ点歌 晴天、#多选网易点歌 青花",
	"QQ 个性化：#每日推荐、#个性电台、#我的收藏、#来首歌"
].join("\n");
const botAccount = (e) => {
	const bot = e.bot;
	if (!bot || typeof bot !== "object" || !("account" in bot)) return void 0;
	const account = bot.account;
	if (!account || typeof account !== "object") return void 0;
	return account;
};
const forwardIdentity = (e) => {
	const account = botAccount(e);
	return {
		id: String(account?.selfId || e.selfId || ""),
		name: account?.name || "音乐"
	};
};
const canSendForward = (e) => {
	const bot = e.bot;
	return Boolean(bot && typeof bot === "object" && "sendForwardMsg" in bot && typeof bot.sendForwardMsg === "function");
};
/** 去掉 LRC 时间轴, 只留可读歌词(云崽转发正文). */
const stripLyricsTimeline = (lyrics) => lyrics.split(/\r?\n/).map((line) => line.match(/^\[.*\](.*)$/)?.[1] ?? line).map((line) => line.trim()).filter(Boolean).join("\n");
const lyricsForwardNodes = (e, item, blocks) => {
	const identity = forwardIdentity(e);
	const header = `${item.title}-${formatArtists(item.artists)}`;
	const nodes = [];
	for (const block of blocks) {
		const plain = stripLyricsTimeline(block);
		if (plain && plain !== block.trim()) nodes.push(...common.makeForward([segment.text(`---${header}---\n${plain}`)], identity.id, identity.name));
		nodes.push(...common.makeForward([segment.text(`---${header}---\n${block}`)], identity.id, identity.name));
	}
	return nodes;
};
/**
* 歌词转发: 完整歌词 + 去掉时间轴的正文(网易云带翻译)各占一层, 不截断.
* 适配器不支持转发时回纯文本, 仍然不截断.
*/
const replyLyrics = async (e, item, blocks) => {
	const nodes = lyricsForwardNodes(e, item, blocks);
	if (canSendForward(e)) try {
		await e.bot.sendForwardMsg(e.contact, nodes, {
			source: "音乐歌词",
			summary: `${item.title} 歌词`,
			prompt: `${item.title} 歌词`,
			news: [{ text: "点击查看完整歌词" }]
		});
		return;
	} catch {}
	await replyPlainText(e, blocks.map((block) => `---${item.title}-${formatArtists(item.artists)}---\n${block}`).join("\n\n"));
};
const playableOfCard = (card) => ({
	item: {
		id: card.musicUrl,
		source: "qq",
		title: card.title,
		artists: card.desc ? [card.desc] : [],
		pageUrl: card.jumpUrl || card.musicUrl
	},
	audioUrl: card.musicUrl
});
const readQuotedMusicCard = async (e) => {
	const replyId = findQuotedMessageId(e.elements);
	if (!replyId) return void 0;
	try {
		return extractQuotedMusicCard(readMessageElements(await e.bot.getMsg(e.contact, replyId)));
	} catch {
		return;
	}
};
/**
* 发送语音: 普通=真语音条(SILK), 高清=原音质直传, 直传失败降级 SILK.
* 高清直传成功才提示 PCQQ 兼容性.
*/
const sendPlayableVoice = async (e, playable, highQuality = false) => {
	try {
		await replyPlainText(e, voiceUploadPlaceholder(playable), { recallMsg: 30 });
	} catch {}
	if (highQuality) {
		let directMessageId;
		try {
			directMessageId = (await e.reply(segment.record(playable.audioUrl)))?.messageId;
		} catch {
			directMessageId = void 0;
		}
		if (directMessageId) {
			try {
				await e.reply([segment.reply(directMessageId), segment.text(pcqqVoiceWarning(playable))]);
			} catch {
				await replyPlainText(e, pcqqVoiceWarning(playable));
			}
			return;
		}
	}
	let voiceFile;
	try {
		voiceFile = await resolveVoiceFile(playable);
	} catch {
		voiceFile = void 0;
	}
	await replyVoiceFileOrAudio(e, playable, voiceFile);
};
const musicFileExtension = (url) => {
	try {
		const ext = path.extname(new URL(url).pathname).replace(/^\./, "");
		return /^[a-zA-Z0-9]{2,5}$/.test(ext) ? ext : "mp3";
	} catch {
		return "mp3";
	}
};
/** 引用卡片下载音乐: 落盘后用 uploadFile 发群文件, 场景不支持时回下载链接. */
const downloadPlayableAudio = async (e, playable) => {
	const dir = ensureTempDir(getTempRoot(), "music-download");
	const filename = `${playable.item.title}-${formatArtists(playable.item.artists)}.${musicFileExtension(playable.audioUrl)}`.replace(/[\\/:*?"<>|]/g, "_");
	const output = path.join(dir, `${Date.now()}-${filename}`);
	await downloadFile({
		url: playable.audioUrl,
		output
	});
	if (["group", "friend"].includes(e.contact.scene) && typeof e.bot.uploadFile === "function") {
		await e.bot.uploadFile(e.contact, output, filename);
		return;
	}
	await replyPlainText(e, `${filename}\n${playable.audioUrl}`);
};
const replyNoSongs = async (e, personalized = false) => {
	await replyText(e, personalized ? "获取推荐歌曲失败，请重试！" : "没有找到歌曲！");
};
const handleMusicMessage = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.music.enabled) return next?.();
	const command = parseMusicCommand(e.msg);
	if (command.type === "none") return next?.();
	try {
		if (command.type === "search") {
			if (!command.keyword) {
				await replyPlainText(e, musicUsage);
				return true;
			}
			const source = command.source ?? Config.music.defaultSource;
			const page = 1;
			const items = await getProvider(source).search(command.keyword, page, Config.music.pageSize);
			if (items.length === 0) {
				await replyNoSongs(e);
				return true;
			}
			const key = sessionKey(e);
			await recallListMessages(store.takeListMessages(key));
			store.set(key, items, {
				keyword: command.keyword,
				source,
				page
			});
			if (command.listMode || Config.music.listModeDefault) {
				const listMessageId = await replyMusicList(e, items, page, { startIndex: 1 });
				if (listMessageId) store.addListMessage(key, {
					contact: e.contact,
					selfId: e.selfId,
					messageId: listMessageId
				});
				return true;
			}
			const first = store.select(key, 1);
			if (!first) {
				await replyNoSongs(e);
				return true;
			}
			await replyMusicPlayable(e, await getProvider(first.source).getPlayable(first));
			return true;
		}
		if (command.type === "select") {
			if (shouldDeferSelection(e.msg, Boolean(store.get(sessionKey(e))))) return next?.();
			const key = sessionKey(e);
			if (!store.get(key)) {
				await replyText(e, "当前没有可选择的点歌列表，先发送 #点歌 歌名");
				return true;
			}
			const item = selectItem(e, command.index);
			if (!item) return next?.();
			await replyMusicPlayable(e, await getProvider(item.source).getPlayable(item));
			return true;
		}
		if (command.type === "nextPage") {
			const key = sessionKey(e);
			const session = store.get(key);
			if (!session) {
				await replyText(e, "当前没有点歌列表，先发送 #点歌 歌名");
				return true;
			}
			const page = session.meta.page + 1;
			const personalizedKind = session.meta.source === "qq" && [
				"dailyRecommend",
				"radio",
				"favorites",
				"random"
			].includes(session.meta.keyword) ? session.meta.keyword : void 0;
			const provider = getProvider(session.meta.source);
			const items = personalizedKind && typeof provider.getPersonalized === "function" ? await provider.getPersonalized(personalizedKind, {
				page,
				pageSize: personalizedKind === "dailyRecommend" ? 30 : Config.music.pageSize
			}) : await provider.search(session.meta.keyword, page, Config.music.pageSize);
			if (items.length === 0) {
				await replyNoSongs(e);
				return true;
			}
			const listMessageId = await replyMusicList(e, items, page, { startIndex: store.appendPage(key, items, page)?.startIndex ?? session.startIndex + session.items.length });
			if (listMessageId) store.addListMessage(key, {
				contact: e.contact,
				selfId: e.selfId,
				messageId: listMessageId
			});
			return true;
		}
		if (command.type === "lyrics") {
			const item = selectItem(e, command.index);
			if (!item) {
				await replyText(e, "当前没有可查询歌词的歌曲");
				return true;
			}
			const lyrics = await getProvider(item.source).getLyrics?.(item);
			const blocks = (Array.isArray(lyrics) ? lyrics : [lyrics]).filter((value) => Boolean(value?.trim()));
			if (blocks.length === 0) {
				await replyText(e, "当前音乐源暂未返回歌词");
				return true;
			}
			await replyLyrics(e, item, blocks);
			return true;
		}
		if (command.type === "voice" || command.type === "download") {
			if (command.type === "voice" && !Config.music.voiceEnabled) {
				await replyText(e, "语音点歌当前未开启");
				return true;
			}
			const card = await readQuotedMusicCard(e);
			if (card) {
				const playable = playableOfCard(card);
				if (command.type === "download") await downloadPlayableAudio(e, playable);
				else await sendPlayableVoice(e, playable, command.highQuality === true);
				return true;
			}
			if (command.type === "download") {
				await replyText(e, "请引用一条音乐分享卡片后再发送 #下载音乐");
				return true;
			}
			const item = selectItem(e, command.index);
			if (!item) {
				await replyText(e, "当前没有可发送语音的歌曲");
				return true;
			}
			await sendPlayableVoice(e, await getProvider(item.source).getPlayable(item), Boolean(command.highQuality || Config.music.highQuality));
			return true;
		}
		if (command.type === "bilibiliLink") {
			const provider = getProvider("bilibili");
			const item = await provider.fromLink(await expandBilibiliLink(command.url));
			await replyMusicPlayable(e, await provider.getPlayable(item));
			return true;
		}
		if (command.type === "random" || command.type === "radio" || command.type === "favorites" || command.type === "dailyRecommend") {
			const provider = getProvider("qq");
			if (typeof provider.getPersonalized !== "function") {
				await replyText(e, "当前音乐源不支持个性化推荐，请配置 QQ 音乐 Cookie 后重试");
				return true;
			}
			const pageSize = command.type === "dailyRecommend" ? 30 : command.type === "radio" ? 5 : Config.music.pageSize;
			if (command.type !== "random") await replyPlainText(e, "请稍候…");
			const items = await provider.getPersonalized(command.type, {
				page: command.type === "favorites" ? command.page ?? 1 : 1,
				pageSize
			});
			if (items.length === 0) {
				await replyNoSongs(e, true);
				return true;
			}
			if (command.type === "random") {
				await replyMusicPlayable(e, await provider.getPlayable(items[0]));
				return true;
			}
			const key = sessionKey(e);
			await recallListMessages(store.takeListMessages(key));
			if (command.type === "radio") {
				await replyMusicPlayable(e, await provider.getPlayable(items[0]));
				return true;
			}
			const page = command.type === "favorites" ? command.page ?? 1 : 1;
			store.set(key, items, {
				keyword: command.type,
				source: "qq",
				page
			});
			const listMessageId = await replyMusicList(e, items, page, { startIndex: 1 });
			if (listMessageId) store.addListMessage(key, {
				contact: e.contact,
				selfId: e.selfId,
				messageId: listMessageId
			});
			return true;
		}
	} catch (error) {
		await replyText(e, error instanceof Error ? error.message : String(error));
		return true;
	}
};
//#endregion
//#region src/music/cookieCommand.ts
const sourceAliases = [
	[/^(?:网易云?|163)$/i, "netease"],
	[/^(?:QQ|扣扣|qqmusic)$/i, "qq"],
	[/^酷我$/i, "kuwo"],
	[/^酷狗$/i, "kugou"],
	[/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, "bilibili"]
];
const parseSource = (value) => sourceAliases.find(([pattern]) => pattern.test(value))?.[1];
/**
* 老用法只有一段 Cookie(`#提交音乐ckMUSIC_U=...`), 按 Cookie 里的关键字段自动判平台.
* 两段式(显式写平台)仍然支持, 且优先级更高.
*/
const detectMusicCookieSource = (cookie) => {
	if (/(?:^|[;\s])MUSIC_U\s*=/i.test(cookie)) return "netease";
	if (/(?:wxunionid|wxuin|psrf_qqunionid|psrf_qqopenid|qqmusic_key|qm_keyst)\s*=/i.test(cookie)) return "qq";
};
const musicCookieHelp = [
	"格式：#提交音乐ck + Cookie（自动识别网易云/QQ音乐）",
	"也支持两段式：#提交音乐ck 平台 Cookie",
	"",
	"--- QQ音乐 ck 获取 ---",
	"请前往 https://y.qq.com/ 获取，必须包含：uin/wxuin、qm_keyst（qqmusic_key）、psrf_qqunionid 或 wxunionid 等字段。",
	"--- 网易云音乐 ck 获取 ---",
	"请前往 https://music.163.com/ 获取，必须包含：MUSIC_U=...（HttpOnly，需抓包或浏览器开发者工具获取）。"
].join("\n");
const parseMusicCookieCommand = (message) => {
	const clean = message.trim();
	if (/^#?(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)$/i.test(clean)) return { type: "status" };
	const submit = clean.match(/^#?提交(?:音乐|点歌)(?:ck|cookie)\s*([\s\S]*)$/i);
	if (!submit) return { type: "none" };
	const body = submit[1].replace(/['"]/g, "").trim();
	if (!body) return { type: "help" };
	const explicit = body.match(/^(\S+)\s+([\s\S]+)$/);
	const explicitSource = explicit ? parseSource(explicit[1]) : void 0;
	if (explicit && explicitSource) return {
		type: "submit",
		source: explicitSource,
		cookie: explicit[2].trim()
	};
	const source = detectMusicCookieSource(body);
	if (!source) return { type: "help" };
	return {
		type: "submit",
		source,
		cookie: body
	};
};
const maskValue = (value) => {
	if (value.length <= 6) return "*".repeat(value.length);
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
};
const maskCookie = (cookie) => {
	if (!cookie.trim()) return "未配置";
	return cookie.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
		const [key, ...rest] = part.split("=");
		const value = rest.join("=");
		if (!value) return key;
		return `${key}=${maskValue(value)}`;
	}).join("; ");
};
//#endregion
//#region src/music/cookieStatus.ts
const configuredStatus = (cookie) => cookie.trim() ? "已配置" : "未配置";
const checkedStatus = async (cookie, check) => {
	if (!cookie.trim()) return "未配置";
	try {
		const result = await check();
		const vip = result.vip === void 0 ? "" : `，${result.vip ? "VIP" : "非VIP"}`;
		return `${result.ok ? "在线" : "失效"}（${result.message}${vip}）`;
	} catch (error) {
		return `检查失败（${error instanceof Error ? error.message : String(error)}）`;
	}
};
const buildMusicCookieStatusLines = async (options) => {
	const { cookies } = options;
	const checkNetease = options.checkNetease ?? (() => new NeteaseProvider({
		baseUrl: options.neteaseBaseUrl ?? "https://neteasecloudmusicapi.vercel.app",
		cookie: cookies.netease
	}).checkCookie());
	const checkQQ = options.checkQQ ?? (() => new QQProvider({
		tempApi: options.qqTempApi ?? "",
		cookie: cookies.qq
	}).checkCookie());
	const [netease, qq] = await Promise.all([checkedStatus(cookies.netease, checkNetease), checkedStatus(cookies.qq, checkQQ)]);
	return [
		"音乐 Cookie 状态",
		`网易云：${netease}`,
		`QQ音乐：${qq}`,
		`酷我：${configuredStatus(cookies.kuwo)}`,
		`酷狗：${configuredStatus(cookies.kugou)}`,
		`哔哩哔哩：${configuredStatus(cookies.bilibili)}`
	];
};
const getMusicCookieStatusLines = (music) => buildMusicCookieStatusLines({
	cookies: music.cookies,
	neteaseBaseUrl: music.api.neteaseBaseUrl,
	qqTempApi: music.api.qqTempApi
});
/**
* 提交前校验: 网易云/QQ 音乐会真实登录一次以回显账号与 VIP;
* 其它平台没有稳定的校验接口, 直接保存(与云崽一致).
*/
const validateMusicCookie = async (options, source, cookie) => {
	if (source === "netease") {
		const result = await new NeteaseProvider({
			baseUrl: options.neteaseBaseUrl ?? "https://neteasecloudmusicapi.vercel.app",
			cookie
		}).checkCookie();
		return {
			checkable: true,
			ok: result.ok,
			message: result.message,
			vip: result.vip
		};
	}
	if (source === "qq") {
		const result = await new QQProvider({
			tempApi: options.qqTempApi ?? "",
			cookie
		}).checkCookie();
		return {
			checkable: true,
			ok: result.ok,
			message: result.message,
			vip: result.vip
		};
	}
	return {
		checkable: false,
		ok: true
	};
};
//#endregion
//#region src/music/cookieController.ts
const sourceName = (source) => ({
	netease: "网易云",
	qq: "QQ音乐",
	kuwo: "酷我",
	kugou: "酷狗",
	bilibili: "哔哩哔哩"
})[source];
const isPrivileged = (e) => Boolean(e.isMaster || e.isAdmin);
const splitStatusLine = (line) => {
	const index = line.indexOf("：");
	if (index < 0) return {
		label: line,
		value: "",
		detail: ""
	};
	const label = line.slice(0, index);
	const rawValue = line.slice(index + 1);
	const detailMatch = rawValue.match(/^(.+?)（(.+)）$/);
	if (!detailMatch) return {
		label,
		value: rawValue,
		detail: ""
	};
	return {
		label,
		value: detailMatch[1] || rawValue,
		detail: detailMatch[2] || ""
	};
};
const cookieStatusKind = (value) => {
	if (/在线|已配置/.test(value)) return "ok";
	if (/未配置/.test(value)) return "off";
	if (/失效|失败/.test(value)) return "warn";
	return "info";
};
const replyMusicCookieStatus = async (e) => {
	const lines = await getMusicCookieStatusLines(Config.music);
	try {
		const images = await renderCardImage({
			name: "music-cookie-status",
			html: buildStatusCardHtml({
				title: "音乐 Cookie 状态",
				subtitle: "各平台登录态和配置状态。",
				eyebrow: "MUSIC.COOKIE",
				items: lines.slice(1).map((line) => {
					const parsed = splitStatusLine(line);
					return {
						label: parsed.label,
						value: parsed.value,
						detail: parsed.detail,
						status: cookieStatusKind(parsed.value)
					};
				})
			}),
			width: 920
		});
		await e.reply(images);
	} catch (error) {
		logCardRenderFailure("music-cookie-status", error);
		await replyText(e, lines.join("\n"));
	}
};
const handleMusicCookieMessage = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	const command = parseMusicCookieCommand(e.msg);
	if (command.type === "none") return next?.();
	if (!isPrivileged(e)) return next?.();
	if (command.type === "help") {
		await replyText(e, musicCookieHelp);
		return true;
	}
	if (command.type === "submit") {
		let result;
		try {
			result = await validateMusicCookie({
				cookies: Config.music.cookies,
				neteaseBaseUrl: Config.music.api.neteaseBaseUrl,
				qqTempApi: Config.music.api.qqTempApi
			}, command.source, command.cookie);
		} catch (error) {
			result = {
				checkable: false,
				ok: true
			};
			logger.warn(`[hira] music cookie validation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (result.checkable && !result.ok) {
			await replyText(e, `${sourceName(command.source)} ck 不正确或已失效，请重新获取！`);
			return true;
		}
		updateMusicCookie(command.source, command.cookie);
		if (result.checkable) {
			await replyText(e, [
				`${sourceName(command.source)}ck 提交成功！`,
				`账号：${result.message ?? "未知"}`,
				`是否VIP：${result.vip ? "是" : "否"}`
			].join("\n"));
			return true;
		}
		await replyText(e, `已更新 ${sourceName(command.source)} Cookie：${maskCookie(command.cookie)}`);
		return true;
	}
	await replyMusicCookieStatus(e);
	return true;
};
//#endregion
//#region src/apps/music.ts
const actionWords = "点歌|点播音乐|点播|播放|放一首|放首|来一首|来首";
const personalizedWords = "每日推荐|每日30首|日推|个性电台|我的收藏|我喜欢的歌";
const commandPrefix = "#?(?:多选)?(?:网易云?|QQ|qq|扣扣|酷我|酷狗|哔哩哔哩|哔哩|B站|bilibili)?(?:多选)?";
const cookieCommand = "#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie))";
/**
* 命令门禁. 与 commandParser 保持一致:
* - 序号(歌词/语音/下载音乐)可省略, 省略时取上次选中/首项(云崽行为);
* - 搜索关键词允许为空, 由处理器回用法说明;
* - 新增 QQ 个性化歌单命令;
* - 排除 cookie 管理命令, 交给 musicCookieReg.
*/
const musicReg = new RegExp(`^(?!${cookieCommand})(${commandPrefix}(?:${actionWords})\\s*[\\s\\S]*|#?(?:听|播放)?[1-9]\\d*|#?下一页|#?歌词\\s*(?:[1-9]\\d*)?|#?(?:高清)?语音\\s*(?:[1-9]\\d*)?|#?下载音乐\\s*(?:[1-9]\\d*)?|#?音乐\\s+https?:\\/\\/[^\\s]+|${commandPrefix}(?:${personalizedWords})\\s*\\d*)$`, "i");
const musicCookieReg = new RegExp(`^${cookieCommand}[\\s\\S]*$`, "i");
const musicCookie = karin.command(musicCookieReg, handleMusicCookieMessage, { name: "Hira-音乐Cookie" });
const music = karin.command(musicReg, handleMusicMessage, { name: "Hira-点歌" });
//#endregion
export { musicReg as i, musicCookie as n, musicCookieReg as r, music as t };

//# sourceMappingURL=music.js.map