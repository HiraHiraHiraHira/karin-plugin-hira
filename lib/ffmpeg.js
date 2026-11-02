import { t as Config, v as toAxiosProxy } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// src/runtime/downloader.ts
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const contentLengthOf = (value) => {
	const parsed = Number(typeof value === "string" ? value : void 0);
	return Number.isFinite(parsed) ? parsed : void 0;
};
const byteLimit = (maxBytes) => {
	if (maxBytes === void 0) return void 0;
	let total = 0;
	return new Transform({ transform(chunk, _encoding, callback) {
		total += Buffer.byteLength(chunk);
		if (total > maxBytes) {
			callback(/* @__PURE__ */ new Error(`下载内容超过 ${maxBytes} 字节限制`));
			return;
		}
		callback(null, chunk);
	} });
};
const writeDownloadedBody = async (body, output, maxBytes) => {
	const webBody = body;
	const source = typeof webBody.getReader === "function" ? Readable.fromWeb(webBody) : body;
	const limiter = byteLimit(maxBytes);
	if (limiter) {
		await pipeline(source, limiter, fs.createWriteStream(output));
		return;
	}
	await pipeline(source, fs.createWriteStream(output));
};
const downloadFile = async (options) => {
	const timeoutMs = options.timeoutMs ?? Math.max(5, Config.runtime.downloadTimeoutSeconds) * 1e3;
	const maxBytes = options.maxBytes;
	const temporaryOutput = `${options.output}.part-${process.pid}-${Math.random().toString(36).slice(2)}`;
	fs.mkdirSync(path.dirname(options.output), { recursive: true });
	try {
		if (options.proxy?.trim()) {
			const response = await axios.get(options.url, {
				headers: {
					"User-Agent": userAgent,
					...options.headers
				},
				timeout: timeoutMs,
				proxy: toAxiosProxy(options.proxy.trim()),
				responseType: "stream",
				maxRedirects: 5,
				validateStatus: () => true
			});
			if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`);
			const contentLength = contentLengthOf(response.headers["content-length"]);
			if (maxBytes !== void 0 && contentLength !== void 0 && contentLength > maxBytes) {
				response.data.destroy();
				throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
			}
			await writeDownloadedBody(response.data, temporaryOutput, maxBytes);
		} else {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetch(options.url, {
					headers: {
						"User-Agent": userAgent,
						...options.headers
					},
					redirect: "follow",
					signal: controller.signal
				});
				if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
				const contentLength = contentLengthOf(response.headers.get("content-length"));
				if (maxBytes !== void 0 && contentLength !== void 0 && contentLength > maxBytes) {
					await response.body.cancel();
					throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
				}
				await writeDownloadedBody(response.body, temporaryOutput, maxBytes);
			} finally {
				clearTimeout(timeout);
			}
		}
		fs.rmSync(options.output, { force: true });
		fs.renameSync(temporaryOutput, options.output);
		return options.output;
	} catch (error) {
		fs.rmSync(temporaryOutput, { force: true });
		throw error;
	}
};
// src/runtime/ffmpeg.ts
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
		options.highQuality ? "2" : "1",
		"-ar",
		options.highQuality ? "48000" : "24000",
		"-codec:a",
		"libopus",
		"-b:a",
		options.highQuality ? "128k" : "32k",
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
export { downloadFile as n, runFfmpeg as t };

//# sourceMappingURL=ffmpeg.js.map