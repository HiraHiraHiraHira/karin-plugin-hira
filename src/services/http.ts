import axios from 'axios'

export type FetchJsonOptions = {
  headers?: Record<string, string>
  defaultHeaders?: boolean
  timeoutMs?: number
  method?: string
  body?: BodyInit
  proxy?: string
  maxBytes?: number
  redirect?: RequestRedirect
  maxRedirects?: number
  signal?: AbortSignal
}

const defaultRequestHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
}

const buildHeaders = (options: FetchJsonOptions) => ({
  ...(options.defaultHeaders === false ? {} : defaultRequestHeaders),
  ...options.headers
})

export const toAxiosProxy = (proxy: string) => {
  let parsed: URL
  try {
    parsed = new URL(proxy)
  } catch {
    throw new Error('代理地址无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('代理只支持 http 或 https 地址')

  return {
    protocol: parsed.protocol.slice(0, -1),
    host: parsed.hostname,
    port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
    ...(parsed.username || parsed.password
      ? {
          auth: {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password)
          }
        }
      : {})
  }
}

const headersFromAxios = (value: Record<string, unknown>) => {
  const headers = new Headers()
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    headers.set(key, Array.isArray(item) ? item.join(', ') : String(item))
  }
  return headers
}

const requestViaProxy = async (url: string, options: FetchJsonOptions): Promise<Response> => {
  const response = await axios.request({
    url,
    method: options.method || 'GET',
    data: options.body,
    headers: buildHeaders(options),
    timeout: options.timeoutMs ?? 15_000,
    proxy: toAxiosProxy(options.proxy!.trim()),
    responseType: 'arraybuffer',
    maxContentLength: options.maxBytes ?? -1,
    maxBodyLength: options.maxBytes ?? -1,
    maxRedirects: options.maxRedirects ?? (options.redirect === 'manual' ? 0 : 5),
    signal: options.signal,
    validateStatus: () => true
  })

  const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || '')
  if (options.maxBytes !== undefined && data.byteLength > options.maxBytes) {
    throw new Error(`响应超过 ${options.maxBytes} 字节限制`)
  }
  return new Response(data, {
    status: response.status,
    statusText: response.statusText,
    headers: headersFromAxios(response.headers as Record<string, unknown>)
  })
}

export const fetchResponse = async (url: string, options: FetchJsonOptions = {}): Promise<Response> => {
  if (options.proxy?.trim()) return requestViaProxy(url, options)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: buildHeaders(options),
      redirect: options.redirect,
      signal: options.signal ?? controller.signal
    })
    const contentLength = Number(response.headers.get('content-length'))
    if (options.maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      await response.body?.cancel()
      throw new Error(`响应超过 ${options.maxBytes} 字节限制`)
    }
    return response
  } finally {
    clearTimeout(timeout)
  }
}

export const readResponseBytes = async (response: Response, maxBytes?: number) => {
  const contentLength = Number(response.headers.get('content-length'))
  if (maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new Error(`响应超过 ${maxBytes} 字节限制`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw new Error(`响应超过 ${maxBytes} 字节限制`)
  return bytes
}

const assertOk = (response: Response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

export const fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> => {
  const response = await fetchResponse(url, options)
  assertOk(response)
  const bytes = await readResponseBytes(response, options.maxBytes)
  return JSON.parse(bytes.toString('utf8')) as T
}

export const fetchText = async (url: string, options: FetchJsonOptions = {}): Promise<string> => {
  const response = await fetchResponse(url, options)
  assertOk(response)
  const bytes = await readResponseBytes(response, options.maxBytes)
  return bytes.toString('utf8')
}

export const resolveRedirectUrl = async (url: string, options: FetchJsonOptions = {}) => {
  let current = url
  const maxRedirects = options.maxRedirects ?? 5

  for (let count = 0; count <= maxRedirects; count++) {
    const response = await fetchResponse(current, {
      ...options,
      redirect: 'manual',
      maxRedirects: 0
    })
    if (response.status < 300 || response.status >= 400) {
      assertOk(response)
      return current
    }

    const location = response.headers.get('location')
    if (!location) throw new Error(`HTTP ${response.status} 重定向缺少 Location`)
    current = new URL(location, current).toString()
  }

  throw new Error('重定向次数超过限制')
}
