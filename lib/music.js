import { c as updateMusicCookie, n as isHiraAppEnabled, r as Config } from "./runtime.js";
import { c as logCardRenderFailure, l as renderCardImage, o as buildStatusCardHtml } from "./cardRender.js";
import { c as normalizeDuration, l as requirePlayableUrl, n as replyMusicList, o as replyText, r as replyMusicPlayable, s as replyVoiceFileOrAudio } from "./message.js";
import { t as fetchJson } from "./http.js";
import { n as downloadFile, t as runFfmpeg } from "./ffmpeg.js";
import { i as getTempRoot, r as ensureTempDir } from "./temp.js";
import karin from "node-karin";
import path from "node:path";
import crypto, { createHash } from "node:crypto";
//#region src/music/commandParser.ts
const sourceAliases$1 = [
	[/^(?:网易云?|163)$/i, "netease"],
	[/^(?:QQ|扣扣|qqmusic)$/i, "qq"],
	[/^酷我$/i, "kuwo"],
	[/^酷狗$/i, "kugou"],
	[/^(?:哔哩哔哩|哔哩|B站|bilibili)$/i, "bilibili"]
];
const sourceWords = [
	"网易云",
	"网易",
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
const actionWords = [
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
	const clean = stripHash(msg);
	if (musicCookieCommandPattern.test(clean)) return { type: "none" };
	const sourcePattern = sourceWords.join("|");
	const actionPattern = actionWords.join("|");
	const search = clean.match(new RegExp(`^(多选)?(${sourcePattern})?(多选)?(?:${actionPattern})\\s*(\\S[\\s\\S]*)$`, "i"));
	if (!search) return { type: "none" };
	const keyword = search[4]?.trim();
	if (!keyword) return { type: "none" };
	return {
		type: "search",
		keyword,
		source: normalizeSource(search[2]),
		listMode: Boolean(search[1] || search[3])
	};
};
//#endregion
//#region src/music/providers/bilibili.ts
const bvPattern = /\bBV[1-9A-HJ-NP-Za-km-z]{10}\b/;
const bilibiliAppSecret = "560c52ccd288fed045859ed18bffd973";
const bilibiliAppHeaders = { "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; MI 9 Build/SKQ1.211230.001)" };
const stripHtml = (value) => (value ?? "").replace(/<[^>]+>/g, "").trim();
const normalizeCover = (url) => {
	if (!url) return void 0;
	return url.startsWith("//") ? `https:${url}` : url;
};
const signedBilibiliAppUrl = (url, params) => {
	const param = Object.entries(params).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
	return `${url}?${param}&sign=${createHash("md5").update(`${param}${bilibiliAppSecret}`).digest("hex")}`;
};
const bilibiliAppParams = (extra) => ({
	access_key: "",
	appkey: "1d8b6e7d45233436",
	build: 7210300,
	buvid: "XU973E09237CC101E74F6E24CCF3DE3300D0B",
	c_locale: "zh_CN",
	channel: "xiaomi",
	disable_rcmd: 0,
	fnval: 16,
	fnver: 0,
	fourk: 1,
	is_dolby: 0,
	is_h265: 0,
	is_proj: 1,
	live_extra: "",
	mobi_app: "android",
	mobile_access_key: "",
	platform: "android",
	playurl_type: 1,
	protocol: 1,
	qn: 64,
	s_locale: "zh_CN",
	statistics: "%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D",
	sys_ver: 31,
	ts: Math.floor(Date.now() / 1e3),
	video_type: 0,
	...extra
});
const getItemBvid = (item) => {
	return item.share?.video?.bvid || item.param?.match(bvPattern)?.[0] || item.uri?.match(bvPattern)?.[0];
};
const selectBilibiliAudio = (payload) => {
	return (payload.data?.dash?.audio ?? []).map((item) => ({
		id: item.id ?? 0,
		url: item.baseUrl || item.base_url || item.backupUrl?.[0] || item.backup_url?.[0] || ""
	})).filter((item) => item.url).sort((a, b) => b.id - a.id)[0];
};
var BilibiliMusicProvider = class {
	source = "bilibili";
	cookie;
	requestJson;
	constructor(options = {}) {
		this.cookie = options.cookie ?? "";
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	requestOptions(referer) {
		return { headers: {
			...bilibiliAppHeaders,
			...referer ? { Referer: referer } : {},
			...this.cookie ? { Cookie: this.cookie } : {}
		} };
	}
	async search(keyword, page, pageSize) {
		const url = signedBilibiliAppUrl("https://app.bilibili.com/x/v2/search/type", bilibiliAppParams({
			keyword: encodeURIComponent(keyword),
			type: 10,
			pn: page,
			ps: pageSize
		}));
		return ((await this.requestJson(url, this.requestOptions())).data?.items ?? []).map((item) => {
			const bvid = getItemBvid(item);
			if (!bvid) return void 0;
			const author = stripHtml(item.author);
			return {
				id: bvid,
				source: "bilibili",
				title: stripHtml(item.title) || "B站视频音频",
				artists: author ? [author] : [],
				durationSeconds: normalizeDuration(item.duration),
				coverUrl: normalizeCover(item.cover),
				pageUrl: item.share?.video?.short_link || `https://www.bilibili.com/video/${bvid}`,
				raw: item
			};
		}).filter((item) => Boolean(item));
	}
	async resolveVideoInfo(item) {
		const raw = item.raw;
		if (raw?.aid && raw?.cid) return raw;
		const bvid = item.id.match(bvPattern)?.[0] || item.pageUrl.match(bvPattern)?.[0];
		if (!bvid) return {};
		return (await this.requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, this.requestOptions(`https://www.bilibili.com/video/${bvid}`))).data ?? {};
	}
	async getPlayable(item) {
		const info = await this.resolveVideoInfo(item);
		if (!info.aid || !info.cid) throw new Error("B站音频解析需要 aid 和 cid，请使用 音乐 <B站链接> 或重新搜索");
		const playUrl = signedBilibiliAppUrl("https://api.bilibili.com/x/tv/playurl", bilibiliAppParams({
			cid: info.cid,
			object_id: info.aid
		}));
		const audio = selectBilibiliAudio(await this.requestJson(playUrl, { defaultHeaders: false }));
		if (!audio) throw new Error("B站未返回可用音频流");
		return {
			item,
			audioUrl: audio.url,
			quality: String(audio.id)
		};
	}
	async fromLink(url) {
		const bvid = url.match(bvPattern)?.[0];
		if (!bvid) return {
			id: url,
			source: "bilibili",
			title: "B站视频音频",
			artists: ["哔哩哔哩"],
			pageUrl: url
		};
		const data = await this.requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, this.requestOptions(`https://www.bilibili.com/video/${bvid}`));
		return {
			id: bvid,
			source: "bilibili",
			title: data.data?.title || "B站视频音频",
			artists: data.data?.owner?.name ? [data.data.owner.name] : ["哔哩哔哩"],
			coverUrl: data.data?.pic,
			durationSeconds: data.data?.duration,
			pageUrl: `https://www.bilibili.com/video/${bvid}`,
			raw: {
				...data.data,
				aid: data.data?.aid,
				cid: data.data?.cid
			}
		};
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
		return ((await this.requestJson(url)).data?.info ?? []).map((item) => ({
			id: item.hash,
			source: "kugou",
			title: item.songname || item.filename || "未知歌曲",
			artists: item.singername ? [item.singername] : [],
			durationSeconds: normalizeDuration(item.duration),
			coverUrl: item.imgurl?.replace("/{size}", ""),
			pageUrl: `https://www.kugou.com/song/#hash=${item.hash}`,
			raw: item
		}));
	}
	async getPlayable(item) {
		const data = await this.requestJson(`https://m.kugou.com/app/i/getSongInfo.php?hash=${encodeURIComponent(item.id)}&cmd=playInfo`);
		return {
			item: {
				...item,
				title: data.fileName || item.title
			},
			audioUrl: requirePlayableUrl(data.url)
		};
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
		return ((await this.requestJson(url, { headers: { Referer: "https://www.kuwo.cn/search/list" } })).data?.list ?? []).map((item) => ({
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
	}
	async getPlayable(item) {
		const data = await this.requestJson(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${encodeURIComponent(item.id)}&type=convert_url&httpsStatus=1`);
		return {
			item,
			audioUrl: requirePlayableUrl(typeof data.data === "string" ? data.data : data.data?.url)
		};
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
	requestJson;
	constructor(options) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.cookie = options.cookie ?? "";
		this.requestJson = options.fetchJson ?? fetchJson;
	}
	async search(keyword, page, pageSize) {
		const offset = Math.max(0, page - 1) * pageSize;
		if (isOfficialNeteaseApiBase(this.baseUrl)) return ((await this.requestJson(`${this.baseUrl}/cloudsearch/pc`, {
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
		const url = `${this.baseUrl}/cloudsearch?keywords=${encodeURIComponent(keyword)}&limit=${pageSize}&offset=${offset}`;
		return ((await this.requestJson(url, this.cookie ? { headers: { Cookie: this.cookie } } : {})).result?.songs ?? []).map((song) => this.toItem(song));
	}
	async getPlayable(item) {
		const fallbackUrl = isOfficialNeteaseApiBase(this.baseUrl) ? `http://music.163.com/song/media/outer/url?id=${encodeURIComponent(item.id)}` : void 0;
		if (this.cookie.includes("MUSIC_U=")) try {
			const request = buildNeteaseHighQualityRequest(item.id);
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
		if (fallbackUrl) return {
			item,
			audioUrl: fallbackUrl
		};
		const url = `${this.baseUrl}/song/url/v1?id=${encodeURIComponent(item.id)}&level=exhigh`;
		const playable = (await this.requestJson(url, this.cookie ? { headers: { Cookie: this.cookie } } : {})).data?.[0];
		return {
			item,
			audioUrl: requirePlayableUrl(playable?.url),
			quality: playable?.level
		};
	}
	async getLyrics(item) {
		const data = await this.requestJson(`${this.baseUrl}/lyric?id=${encodeURIComponent(item.id)}`);
		return data.lrc?.lyric || data.tlyric?.lyric;
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
const buildNeteaseHighQualityRequest = (id) => ({
	url: "https://interface3.music.163.com/api/song/enhance/player/url/v1",
	body: new URLSearchParams({
		ids: `[${id}]`,
		level: "exhigh",
		encodeType: "mp3"
	}).toString()
});
const normalizeNeteaseCookieStatus = (payload) => {
	const data = payload && typeof payload === "object" ? payload : {};
	if (data.code === 200 && data.profile?.nickname) return {
		ok: true,
		message: data.profile.nickname
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
const asRecord = (value) => {
	return value && typeof value === "object" ? value : {};
};
const normalizeQQSearchResult = (payload) => {
	const song = asRecord(asRecord(asRecord(asRecord(asRecord(payload).req_1).data).body).song);
	return (Array.isArray(song.list) ? song.list : []).map((item) => {
		const mid = item.mid || item.songmid || String(item.id ?? item.songid ?? "");
		const albumMid = item.album?.pmid || item.album?.mid || "";
		return {
			id: mid,
			source: "qq",
			title: item.name || item.songname || "未知歌曲",
			artists: (item.singer ?? []).map((singer) => singer.name || "").filter(Boolean),
			album: item.album?.name,
			durationSeconds: normalizeDuration(item.interval),
			coverUrl: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : void 0,
			pageUrl: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
			raw: item
		};
	}).filter((item) => item.id);
};
const pickQQPlayableUrl = (payload) => {
	const data = asRecord(asRecord(asRecord(payload).req_0).data);
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
const normalizeQQCookieStatus = (payload) => {
	const data = asRecord(payload);
	const nick = data.data?.creator?.nick?.trim();
	if (data.code === 0 && nick) return {
		ok: true,
		message: nick
	};
	return {
		ok: false,
		message: "Cookie 失效或未登录"
	};
};
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
const buildQQVkeyBody = (songmid) => ({ req_0: {
	module: "vkey.GetVkeyServer",
	method: "CgiGetVkey",
	param: {
		guid: "10000",
		songmid: [songmid],
		songtype: [0],
		uin: "0",
		loginflag: 1,
		platform: "20",
		filename: [`M800${songmid}.mp3`]
	}
} });
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
	async search(keyword, page, pageSize) {
		try {
			const items = normalizeQQSearchResult(await this.requestJson(musicuUrl, {
				method: "POST",
				body: JSON.stringify(buildQQSearchBody(keyword, page, pageSize)),
				headers: {
					"Content-Type": "application/json",
					Referer: "https://y.qq.com/",
					...this.cookie ? { Cookie: this.cookie } : {}
				}
			}));
			if (items.length > 0) return items;
		} catch {}
		return Array.from({ length: Math.min(pageSize, 5) }, (_, index) => ({
			id: `${keyword}:${index + 1}`,
			source: "qq",
			title: `${keyword} #${index + 1}`,
			artists: ["QQ音乐"],
			pageUrl: `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(keyword)}`,
			raw: {
				keyword,
				index: index + 1
			}
		}));
	}
	async getPlayable(item) {
		try {
			const audioUrl = pickQQPlayableUrl(await this.requestJson(musicuUrl, {
				method: "POST",
				body: JSON.stringify(buildQQVkeyBody(item.id)),
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
		const legacyUrl = buildLegacyQQShareMusicUrl(item.id);
		if (legacyUrl) return {
			item,
			audioUrl: legacyUrl
		};
		if (!this.tempApi) throw new Error("QQ音乐暂未返回可播放链接");
		const raw = item.raw;
		const keyword = raw?.keyword || item.title;
		const index = raw?.index || 1;
		const data = await fetchJson(this.tempApi.replace("{keyword}", encodeURIComponent(keyword)).replace("{index}", String(index)));
		return {
			item,
			audioUrl: requirePlayableUrl(data.music_url || data.url || data.data?.music_url || data.data?.url)
		};
	}
	async getLyrics(item) {
		const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(item.id)}&format=json&nobase64=0`;
		const data = await this.requestJson(url, { headers: {
			Referer: "https://y.qq.com/",
			...this.cookie ? { Cookie: this.cookie } : {}
		} });
		return [decodeQQLyric(data.lyric), decodeQQLyric(data.trans)].filter(Boolean).join("\n\n");
	}
	async checkCookie() {
		if (!this.cookie.trim()) return {
			ok: false,
			message: "未配置 Cookie"
		};
		return normalizeQQCookieStatus(await this.requestJson(profileUrl, { headers: {
			Referer: "https://y.qq.com/",
			Cookie: this.cookie
		} }));
	}
};
//#endregion
//#region src/music/providers/index.ts
const createMusicProviders = () => {
	const music = Config.music;
	const providers = /* @__PURE__ */ new Map();
	providers.set("netease", new NeteaseProvider({
		baseUrl: music.api.neteaseBaseUrl,
		cookie: music.cookies.netease
	}));
	providers.set("qq", new QQProvider({
		tempApi: music.api.qqTempApi,
		cookie: music.cookies.qq
	}));
	providers.set("kuwo", new KuwoProvider());
	providers.set("kugou", new KugouProvider());
	providers.set("bilibili", new BilibiliMusicProvider({ cookie: music.cookies.bilibili }));
	return providers;
};
//#endregion
//#region src/music/selection.ts
const isBareNumericSelection = (message) => /^\s*[1-9]\d*\s*$/.test(message);
const shouldDeferSelection = (message, hasSession) => {
	return isBareNumericSelection(message) && !hasSession;
};
//#endregion
//#region src/music/session.ts
var MusicSessionStore = class {
	ttlMs;
	now;
	sessions = /* @__PURE__ */ new Map();
	constructor(options) {
		this.ttlMs = options.ttlMs;
		this.now = options.now ?? Date.now;
	}
	set(key, items, meta) {
		this.sessions.set(key, {
			items,
			meta,
			expiresAt: this.now() + this.ttlMs
		});
	}
	get(key) {
		const session = this.sessions.get(key);
		if (!session) return void 0;
		if (session.expiresAt <= this.now()) {
			this.sessions.delete(key);
			return;
		}
		return session;
	}
	select(key, oneBasedIndex) {
		const session = this.get(key);
		if (!session || oneBasedIndex < 1) return void 0;
		const item = session.items[oneBasedIndex - 1];
		if (!item) return void 0;
		session.lastSelected = item;
		return item;
	}
	getLastSelected(key) {
		return this.get(key)?.lastSelected;
	}
};
//#endregion
//#region src/music/voice.ts
const buildVoiceTempPaths = (root = getTempRoot()) => {
	const dir = ensureTempDir(root, "music-voice");
	return {
		source: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.audio`),
		output: path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`)
	};
};
const transcodePlayableToVoice = async (playable) => {
	const paths = buildVoiceTempPaths();
	await downloadFile({
		url: playable.audioUrl,
		output: paths.source
	});
	await runFfmpeg({
		input: paths.source,
		output: paths.output,
		format: "voice"
	});
	return paths.output;
};
//#endregion
//#region src/music/controller.ts
const store = new MusicSessionStore({ ttlMs: Config.music.sessionTtlSeconds * 1e3 });
const sessionKey = (e) => {
	const groupPeer = e.isGroup ? e.contact.peer : "";
	return `${e.selfId}:${groupPeer || e.userId}`;
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
const handleMusicMessage = async (e, next) => {
	if (!isHiraAppEnabled()) return next?.();
	if (!Config.music.enabled) return next?.();
	const command = parseMusicCommand(e.msg);
	if (command.type === "none") return next?.();
	try {
		if (command.type === "search") {
			const source = command.source ?? Config.music.defaultSource;
			const page = 1;
			const items = await getProvider(source).search(command.keyword, page, Config.music.pageSize);
			store.set(sessionKey(e), items, {
				keyword: command.keyword,
				source,
				page
			});
			if (command.listMode || Config.music.listModeDefault) {
				await replyMusicList(e, items, page);
				return true;
			}
			const first = store.select(sessionKey(e), 1);
			if (!first) {
				await replyText(e, "没有搜到相关歌曲");
				return true;
			}
			await replyMusicPlayable(e, await getProvider(first.source).getPlayable(first));
			return true;
		}
		if (command.type === "select") {
			if (shouldDeferSelection(e.msg, Boolean(store.get(sessionKey(e))))) return next?.();
			const item = selectItem(e, command.index);
			if (!item) {
				await replyText(e, "当前没有可选择的点歌列表，先发送 #点歌 歌名");
				return true;
			}
			await replyMusicPlayable(e, await getProvider(item.source).getPlayable(item));
			return true;
		}
		if (command.type === "nextPage") {
			const session = store.get(sessionKey(e));
			if (!session) {
				await replyText(e, "当前没有点歌列表，先发送 #点歌 歌名");
				return true;
			}
			const page = session.meta.page + 1;
			const items = await getProvider(session.meta.source).search(session.meta.keyword, page, Config.music.pageSize);
			store.set(sessionKey(e), items, {
				...session.meta,
				page
			});
			await replyMusicList(e, items, page);
			return true;
		}
		if (command.type === "lyrics") {
			const item = selectItem(e, command.index);
			if (!item) {
				await replyText(e, "当前没有可查询歌词的歌曲");
				return true;
			}
			const lyrics = await getProvider(item.source).getLyrics?.(item);
			await replyText(e, lyrics?.trim() ? lyrics.slice(0, 1800) : "当前音乐源暂未返回歌词");
			return true;
		}
		if (command.type === "voice") {
			if (!Config.music.voiceEnabled) {
				await replyText(e, "语音点歌当前未开启");
				return true;
			}
			const item = selectItem(e, command.index);
			if (!item) {
				await replyText(e, "当前没有可发送语音的歌曲");
				return true;
			}
			const playable = await getProvider(item.source).getPlayable(item);
			try {
				await replyVoiceFileOrAudio(e, playable, await transcodePlayableToVoice(playable));
			} catch {
				await replyVoiceFileOrAudio(e, playable);
			}
			return true;
		}
		if (command.type === "bilibiliLink") {
			const provider = getProvider("bilibili");
			const item = await provider.fromLink(command.url);
			await replyMusicPlayable(e, await provider.getPlayable(item));
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
const parseMusicCookieCommand = (message) => {
	const clean = message.trim();
	if (/^#?(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)$/i.test(clean)) return { type: "status" };
	const submit = clean.match(/^#?提交(?:音乐|点歌)(?:ck|cookie)\s+(\S+)\s+([\s\S]+)$/i);
	if (!submit) return { type: "none" };
	const source = parseSource(submit[1]);
	const cookie = submit[2]?.trim();
	if (!source || !cookie) return { type: "none" };
	return {
		type: "submit",
		source,
		cookie
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
		return `${result.ok ? "在线" : "失效"}（${result.message}）`;
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
	if (!isPrivileged(e)) {
		await replyText(e, "音乐 Cookie 只能由主人或管理员管理");
		return true;
	}
	if (command.type === "submit") {
		updateMusicCookie(command.source, command.cookie);
		await replyText(e, `已更新 ${sourceName(command.source)} Cookie：${maskCookie(command.cookie)}`);
		return true;
	}
	await replyMusicCookieStatus(e);
	return true;
};
//#endregion
//#region src/apps/music.ts
const musicReg = /^(?!#?(?:(?:点歌|音乐)(?:ck|cookie)(?:检查|状态)|提交(?:音乐|点歌)(?:ck|cookie)(?:\s|$)))(#?(?:多选)?(?:网易云?|QQ|qq|扣扣|酷我|酷狗|哔哩哔哩|哔哩|B站|bilibili)?(?:多选)?(?:点歌|点播音乐|点播|播放|放一首|放首|来一首|来首)\s*\S[\s\S]*|#?(?:听|播放)?[1-9]\d*|#?下一页|#?歌词\s*[1-9]\d*|#?(?:高清)?语音\s*[1-9]\d*|#?音乐\s+https?:\/\/[^\s]+)$/i;
const musicCookieReg = /^#?(?:提交(?:音乐|点歌)(?:ck|cookie)\s+\S+\s+[\s\S]+|(?:点歌|音乐)(?:ck|cookie)(?:检查|状态))$/i;
const musicCookie = karin.command(musicCookieReg, handleMusicCookieMessage, {
	name: "Hira-音乐Cookie",
	priority: 690
});
const music = karin.command(musicReg, handleMusicMessage, {
	name: "Hira-点歌",
	priority: 700
});
//#endregion
export { musicReg as i, musicCookie as n, musicCookieReg as r, music as t };

//# sourceMappingURL=music.js.map