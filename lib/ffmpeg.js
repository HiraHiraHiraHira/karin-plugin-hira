import { r as Config } from "./runtime.js";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
//#region src/runtime/downloader.ts
const downloadFile = async (options) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6e4);
	try {
		const response = await fetch(options.url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
				...options.headers
			},
			signal: controller.signal
		});
		if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
		await pipeline(response.body, fs.createWriteStream(options.output));
		return options.output;
	} finally {
		clearTimeout(timeout);
	}
};
//#endregion
//#region src/runtime/ffmpeg.ts
const execFileAsync = promisify(execFile);
const buildFfmpegArgs = (options) => {
	if (options.format === "merge") return [
		"-y",
		"-i",
		options.videoInput,
		"-i",
		options.audioInput,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-c",
		"copy",
		options.output
	];
	if (options.format === "copy") return [
		"-y",
		"-i",
		options.input,
		"-c",
		"copy",
		options.output
	];
	if (options.format === "qq-video") return [
		"-y",
		"-i",
		options.input,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-profile:a",
		"aac_low",
		"-b:a",
		"128k",
		"-movflags",
		"+faststart",
		options.output
	];
	if (options.format === "voice") return [
		"-y",
		"-i",
		options.input,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"24000",
		"-codec:a",
		"libopus",
		"-b:a",
		"32k",
		options.output
	];
	return [
		"-y",
		"-i",
		options.input,
		"-vn",
		"-codec:a",
		"libmp3lame",
		"-b:a",
		"192k",
		options.output
	];
};
const runFfmpeg = async (options) => {
	await execFileAsync(Config.runtime.ffmpegPath || "ffmpeg", buildFfmpegArgs(options), {
		windowsHide: true,
		timeout: Math.max(10, Config.runtime.downloadTimeoutSeconds) * 1e3
	});
	return options.output;
};
//#endregion
export { downloadFile as n, runFfmpeg as t };

//# sourceMappingURL=ffmpeg.js.map