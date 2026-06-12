export type FetchJsonOptions = {
  headers?: Record<string, string>
  defaultHeaders?: boolean
  timeoutMs?: number
  method?: string
  body?: BodyInit
}

const defaultRequestHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
}

const buildHeaders = (options: FetchJsonOptions) => ({
  ...(options.defaultHeaders === false ? {} : defaultRequestHeaders),
  ...options.headers
})

export const fetchJson = async <T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)

  try {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: buildHeaders(options),
      signal: controller.signal
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

export const fetchText = async (url: string, options: FetchJsonOptions = {}): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)

  try {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: buildHeaders(options),
      signal: controller.signal
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}
