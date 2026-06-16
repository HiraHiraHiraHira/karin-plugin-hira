//#region src/services/http.ts
const defaultRequestHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
const buildHeaders = (options) => ({
	...options.defaultHeaders === false ? {} : defaultRequestHeaders,
	...options.headers
});
const fetchJson = async (url, options = {}) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
	try {
		const response = await fetch(url, {
			method: options.method,
			body: options.body,
			headers: buildHeaders(options),
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
};
const fetchText = async (url, options = {}) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
	try {
		const response = await fetch(url, {
			method: options.method,
			body: options.body,
			headers: buildHeaders(options),
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
};
//#endregion
export { fetchText as n, fetchJson as t };

//# sourceMappingURL=http.js.map