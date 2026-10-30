import { Config } from '@/config'
import { fetchJson } from '@/services/http'

export type LightResult =
  | { type: 'image', title: string, url: string }
  | { type: 'text', title: string, text: string }
  | { type: 'forward', title: string, prompt: string, lines: string[] }

/** 各图源字段名不同：suyanw 是 `imgurl`、imgapi 是 `imgurls`，thecatapi 是 `[{url}]`。 */
const imageUrlKeys = ['imgurls', 'imgurl', 'images', 'urls', 'url', 'image', 'pic']
const containerKeys = ['data', 'result', 'list']

const collectImageUrls = (payload: unknown): string[] => {
  if (typeof payload === 'string') return /^https?:\/\//i.test(payload.trim()) ? [payload.trim()] : []
  if (Array.isArray(payload)) return payload.flatMap(item => collectImageUrls(item))
  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>
  for (const key of [...imageUrlKeys, ...containerKeys]) {
    if (!(key in record)) continue
    const urls = collectImageUrls(record[key])
    if (urls.length > 0) return urls
  }
  return []
}

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** 接口返回的 JSON 是外部输入，统一收窄成对象后再取字段。 */
const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

/** 上游列表结构不一：`{data: []}`、`{data: {list: []}}`、`{list: []}` 都认。 */
const extractList = (payload: unknown): unknown[] => {
  const root = asRecord(payload)
  const data = root.data ?? root.result ?? root.list
  if (Array.isArray(data)) return data
  const nested = asRecord(data).list
  return Array.isArray(nested) ? nested : []
}

/** 并发拉取多个图源，失败源自动跳过（R cospro 原样合并 2 个 cos 接口）。 */
const fetchImagesFrom = async (apis: string[]): Promise<string[]> => {
  const settled = await Promise.allSettled(apis.map(api => fetchJson<unknown>(api)))
  return [...new Set(settled.flatMap(result => (result.status === 'fulfilled' ? collectImageUrls(result.value) : [])))]
}

const fetchFirstImage = async (apis: string[], title: string): Promise<LightResult> => {
  for (const api of apis) {
    try {
      const url = collectImageUrls(await fetchJson<unknown>(api))[0]
      if (url) return { type: 'image', title, url }
    } catch {
      // Try next configured API.
    }
  }
  throw new Error(`${title}接口暂时不可用`)
}

/** 各图源用的张数参数名不一致（shibe 是 count、thecatapi 是 limit），按需要张数改写才能真正拿到多张。 */
const applyImageLimit = (api: string, limit: number) => {
  try {
    const url = new URL(api)
    if (url.searchParams.has('count')) url.searchParams.set('count', String(limit))
    else if (url.searchParams.has('limit')) url.searchParams.set('limit', String(limit))
    return url.toString()
  } catch {
    // 配置里可能是非法 URL，原样交给请求阶段暴露错误，避免这里静默吞掉
    return api
  }
}

/** 猫图多张并发：各配置源并发拉取，去重后按需要张数截断，失败源自动跳过。 */
export const getCatImages = async (limit = 10): Promise<string[]> => {
  const urls = await fetchImagesFrom(Config.light.catApis.map(api => applyImageLimit(api, limit)))
  return urls.slice(0, limit)
}

export const getBuyerShowImage = () => fetchFirstImage(Config.light.buyerShowApis, '买家秀')

/** 累了：imgapi 的 cos/cos2 返回 `{imgurls: []}`，两张接口全部取回后合并。 */
export const getTiredImages = async (): Promise<string[]> => {
  const urls = await fetchImagesFrom(Config.light.tiredApis)
  if (urls.length === 0) throw new Error('累了接口暂时不可用')
  return urls
}

export const tiredPrompt = '哪天克火掉一定是在这个群里面...'

const normalizeListText = (payload: unknown, emptyText: string) => {
  const lines = extractList(payload).slice(0, 5).map((item, index) => {
    const obj = asRecord(item)
    const title = String(obj.title ?? obj.name ?? obj.goodsName ?? obj.softName ?? `结果 ${index + 1}`)
    const desc = stripHtml(String(obj.introduction ?? obj.desc ?? obj.description ?? obj.content ?? ''))
    const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? '')
    return [`${index + 1}. ${title}`, desc, url].filter(Boolean).join('\n')
  })

  return lines.length ? lines.join('\n\n') : emptyText
}

/** dayi 医药源条目：标题 - 副标题 + 简介（R query.js doctor 原样，含 secondTitle）。 */
const dayiEntryLines = (list: unknown[]) => list.map((item) => {
  const obj = asRecord(item)
  const title = stripHtml(String(obj.title ?? ''))
  const secondTitle = stripHtml(String(obj.secondTitle ?? ''))
  const intro = stripHtml(String(obj.introduction ?? ''))
  const header = [title, secondTitle].filter(Boolean).join(' - ')
  return [`📌 ${header || '未知药品'}`, intro ? `📝 简介：${intro}` : ''].filter(Boolean).join('\n')
})

const softwareItemTitle = (item: unknown) => {
  const obj = asRecord(item)
  return stripHtml(String(obj.title ?? obj.name ?? obj.softName ?? obj.goodsName ?? '未知软件'))
}

/** R query.js 的转发文案：`推荐软件：${title}` + `地址：${url}`。 */
const softwareEntryLines = (items: unknown[]) => items.map((item) => {
  const obj = asRecord(item)
  const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? '')
  return [`推荐软件：${softwareItemTitle(item)}`, url ? `地址：${url}` : ''].filter(Boolean).join('\n')
})

/** dayi 是唯一证书链损坏的源（UNABLE_TO_VERIFY_LEAF_SIGNATURE），只有它关闭校验，其余源保持严格校验。 */
const needsInsecureTls = (url: string) => {
  try {
    return new URL(url).hostname === 'server.dayi.org.cn'
  } catch {
    return false
  }
}

export const queryMedicine = async (keyword: string): Promise<LightResult> => {
  // R query.js doctor 允许空关键词（`#医药查询` 原样请求全部）。
  const url = Config.light.medicineApi.replace('{keyword}', encodeURIComponent(keyword.trim()))
  const payload = await fetchJson<unknown>(url, needsInsecureTls(url) ? { insecure: true } : {})
  const list = asRecord(payload).list
  if (Array.isArray(list) && list.length > 0) {
    const lines = dayiEntryLines(list)
    return { type: 'forward', title: '医药查询', prompt: `查询到 ${lines.length} 条医药信息`, lines }
  }
  const fallback = Array.isArray(list) ? '' : normalizeListText(payload, '')
  return { type: 'text', title: '医药查询', text: fallback || '未找到相关医药信息' }
}

// ghxi 只有榜单接口，不接受关键词，因此内置源必须本地过滤。
const softwareSources = [
  'https://www.ghxi.com/ghapi?type=query&n=pc',
  'https://www.ghxi.com/ghapi?type=query&n=and'
]

const fetchSoftwareSources = async () => {
  const settled = await Promise.allSettled(softwareSources.map(url => fetchJson<unknown>(url)))
  const merged = settled.flatMap(result => (result.status === 'fulfilled' ? extractList(result.value) : []))
  const seen = new Set<string>()
  return merged.filter((item) => {
    const key = softwareItemTitle(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 条目的名称字段在不同接口里叫 title/name/softName，任一命中即可。
const filterSoftware = (items: unknown[], needle: string) => items.filter((item) => {
  const obj = asRecord(item)
  return [obj.title, obj.name, obj.softName].some(
    value => typeof value === 'string' && value.toLowerCase().includes(needle)
  )
})

export const querySoftware = async (keyword: string): Promise<LightResult> => {
  const needle = keyword.trim().toLowerCase()
  const configured = Config.light.softwareApi.trim()

  if (configured) {
    const url = configured.replace('{keyword}', encodeURIComponent(keyword.trim()))
    const items = extractList(await fetchJson<unknown>(url))
    if (!needle) {
      const lines = softwareEntryLines(items)
      return lines.length
        ? { type: 'forward', title: '推荐软件', prompt: `共 ${lines.length} 条软件推荐`, lines }
        : { type: 'text', title: '推荐软件', text: '未找到相关软件' }
    }
    return {
      type: 'text',
      title: '推荐软件',
      text: normalizeListText({ list: filterSoftware(items, needle) }, `未找到与「${keyword.trim()}」相关的软件`)
    }
  }

  const deduped = await fetchSoftwareSources()
  // R query.js softwareRecommended 无关键词，直接返回全部榜单并合并转发。
  if (!needle) {
    const lines = softwareEntryLines(deduped)
    return lines.length
      ? { type: 'forward', title: '推荐软件', prompt: `共 ${lines.length} 条软件推荐`, lines }
      : { type: 'text', title: '推荐软件', text: '未找到相关软件' }
  }

  const matched = filterSoftware(deduped, needle)
  if (matched.length) {
    return {
      type: 'text',
      title: '推荐软件',
      text: normalizeListText({ list: matched }, '未找到相关软件')
    }
  }
  if (!deduped.length) return { type: 'text', title: '推荐软件', text: '未找到相关软件' }

  return {
    type: 'text',
    title: '推荐软件',
    text: [
      `未找到与「${keyword.trim()}」相关的软件，以下是最近更新：`,
      normalizeListText({ list: deduped.slice(0, 5) }, '')
    ].filter(Boolean).join('\n')
  }
}
