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

// 取原始错误的可读文案，包中文网络错误时把英文细节附在后面便于排查
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

// 调用方主动取消/中止类错误：原样抛出，不包成中文网络错误
const isAbortLike = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const { name, code } = error as { name?: unknown, code?: unknown }
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED'
}

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
  }).catch((error: unknown) => {
    // 网络层失败统一包中文，保留原始英文细节；主动取消仍原样抛出
    if (isAbortLike(error)) throw error
    throw new Error(`网络请求失败：${errorMessage(error)}`)
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

// 合并调用方 signal 与本地超时：两者任一触发都会中止请求，且能区分是超时还是调用方主动取消
const createAbortSignal = (timeoutMs: number, external?: AbortSignal) => {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export const fetchResponse = async (url: string, options: FetchJsonOptions = {}): Promise<Response> => {
  if (options.proxy?.trim()) return requestViaProxy(url, options)

  const timeoutMs = options.timeoutMs ?? 15_000
  const { signal, didTimeout, cleanup } = createAbortSignal(timeoutMs, options.signal)
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: buildHeaders(options),
      redirect: options.redirect,
      signal
    })
  } catch (error) {
    if (didTimeout()) throw new Error(`请求超时（${timeoutMs} ms）`)
    if (isAbortLike(error)) throw error
    throw new Error(`网络请求失败：${errorMessage(error)}`)
  } finally {
    cleanup()
  }

  const contentLength = Number(response.headers.get('content-length'))
  if (options.maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    await response.body?.cancel()
    throw new Error(`响应超过 ${options.maxBytes} 字节限制`)
  }
  return response
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
  if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`)
}

export const fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> => {
  const response = await fetchResponse(url, options)
  assertOk(response)
  const bytes = await readResponseBytes(response, options.maxBytes)
  const text = bytes.toString('utf8')
  try {
    return JSON.parse(text) as T
  } catch {
    // 上游可能返回 HTML 风控页，原生 JSON.parse 英文报错不能进群，这里换成中文具体文案
    const preview = text.slice(0, 60).replace(/\s+/g, ' ')
    throw new Error(`接口返回的不是 JSON（HTTP ${response.status}，开头：${preview}）`)
  }
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
