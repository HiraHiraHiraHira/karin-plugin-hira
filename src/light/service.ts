import { Config } from '@/config'
import { fetchJson } from '@/services/http'

export type LightResult =
  | { type: 'image', title: string, url: string }
  | { type: 'text', title: string, text: string }

const firstString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(firstString).find(Boolean)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return firstString(obj.url) ?? firstString(obj.imgurl) ?? firstString(obj.image) ?? firstString(obj.pic)
  }
  return undefined
}

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

const fetchAllImages = async (apis: string[]): Promise<string[]> => {
  const settled = await Promise.allSettled(apis.map(async (api) => {
    const payload = await fetchJson<unknown>(api)
    // shibe 在线返回数组、thecatapi 返回 [{url}]，统一抽 URL
    if (Array.isArray(payload)) return payload.map(firstString).filter((url): url is string => Boolean(url))
    const url = firstString(payload)
    return url ? [url] : []
  }))
  return settled.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
}

const fetchFirstImage = async (apis: string[], title: string): Promise<LightResult> => {
  for (const api of apis) {
    try {
      const payload = await fetchJson<unknown>(api)
      const url = firstString(payload)
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
  const urls = await fetchAllImages(Config.light.catApis.map(api => applyImageLimit(api, limit)))
  return [...new Set(urls)].slice(0, limit)
}

export const getBuyerShowImage = () => fetchFirstImage(Config.light.buyerShowApis, '买家秀')

export const getTiredImage = () => fetchFirstImage(Config.light.tiredApis, '累了')

const normalizeListText = (payload: unknown, emptyText: string) => {
  // 上游接口可能回 null，统一按空响应处理，避免取属性时抛错盖掉空结果文案
  const root = (payload ?? {}) as Record<string, unknown>
  const data = (root.data ?? root.result ?? root.list) as unknown
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown> | undefined)?.list)
      ? (data as { list: unknown[] }).list
      : []

  const lines = list.slice(0, 5).map((item, index) => {
    const obj = item as Record<string, unknown>
    const title = String(obj.title ?? obj.name ?? obj.goodsName ?? obj.softName ?? `结果 ${index + 1}`)
    const desc = stripHtml(String(obj.introduction ?? obj.desc ?? obj.description ?? obj.content ?? ''))
    const url = String(obj.url ?? obj.link ?? obj.downloadUrl ?? '')
    return [`${index + 1}. ${title}`, desc, url].filter(Boolean).join('\n')
  })

  return lines.length ? lines.join('\n\n') : emptyText
}

/** dayi 医药源条目：标题 - 副标题 + 简介（R query.js doctor 原样，含 secondTitle）。 */
const normalizeDayiText = (payload: unknown, emptyText: string) => {
  const root = (payload ?? {}) as Record<string, unknown>
  const list = Array.isArray(root.list) ? root.list : []
  const lines = list.slice(0, 10).map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>
    const title = stripHtml(String(obj.title ?? ''))
    const secondTitle = stripHtml(String(obj.secondTitle ?? ''))
    const intro = stripHtml(String(obj.introduction ?? ''))
    const header = [title, secondTitle].filter(Boolean).join(' - ')
    return [`📌 ${header || '未知药品'}`, intro ? `📝 简介：${intro}` : ''].filter(Boolean).join('\n')
  })
  return lines.length ? lines.join('\n\n') : emptyText
}

/** dayi 是唯一证书链损坏的源（UNABLE_TO_VERIFY_LEAF_SIGNATURE），只有它关闭校验，其余源保持严格校验。 */
const needsInsecureTls = (url: string) => {
  try {
    return new URL(url).hostname === 'server.dayi.org.cn'
  } catch {
    return false
  }
}

export const queryMedicine = async (keyword: string): Promise<LightResult> => {
  const url = Config.light.medicineApi.replace('{keyword}', encodeURIComponent(keyword))
  const payload = await fetchJson<unknown>(url, needsInsecureTls(url) ? { insecure: true } : {})
  const list = ((payload ?? {}) as Record<string, unknown>).list
  return {
    type: 'text',
    title: '医药查询',
    text: Array.isArray(list)
      ? normalizeDayiText(payload, '未找到相关医药信息')
      : normalizeListText(payload, '未找到相关医药信息')
  }
}

// ghxi 只有榜单接口，不接受关键词，因此内置源必须本地过滤。
const softwareSources = [
  'https://www.ghxi.com/ghapi?type=query&n=pc',
  'https://www.ghxi.com/ghapi?type=query&n=and'
]

export const querySoftware = async (keyword: string): Promise<LightResult> => {
  const configured = Config.light.softwareApi.trim()
  // 配置了搜索接口就交给服务端搜索；留空才回落到内置 ghxi 榜单。
  if (configured) {
    const url = configured.replace('{keyword}', encodeURIComponent(keyword))
    const payload = await fetchJson<unknown>(url)
    return {
      type: 'text',
      title: '推荐软件',
      text: normalizeListText(payload, '未找到相关软件')
    }
  }

  const settled = await Promise.allSettled(softwareSources.map(url => fetchJson<unknown>(url)))
  const merged = settled.flatMap((result) => {
    if (result.status !== 'fulfilled') return []
    const root = (result.value ?? {}) as Record<string, unknown>
    const data = root.data ?? root.result ?? root.list
    if (Array.isArray(data)) return data
    const nested = (data as Record<string, unknown> | undefined)?.list
    return Array.isArray(nested) ? nested : []
  })
  const seen = new Set<string>()
  const deduped = merged.filter((item) => {
    const obj = (item ?? {}) as Record<string, unknown>
    const key = String([obj.title, obj.name, obj.softName].find(value => typeof value === 'string' && value) ?? JSON.stringify(obj))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const needle = keyword.trim().toLowerCase()
  const matched = needle
    ? deduped.filter((item) => {
      const obj = (item ?? {}) as Record<string, unknown>
      // 条目的名称字段在不同接口里叫 title/name/softName，任一命中即可
      return [obj.title, obj.name, obj.softName].some(
        value => typeof value === 'string' && value.toLowerCase().includes(needle)
      )
    })
    : deduped
  if (matched.length) {
    return {
      type: 'text',
      title: '推荐软件',
      text: normalizeListText({ list: matched }, '未找到相关软件')
    }
  }
  if (!deduped.length) {
    return { type: 'text', title: '推荐软件', text: '未找到相关软件' }
  }
  return {
    type: 'text',
    title: '推荐软件',
    text: [
      `未找到与「${keyword}」相关的软件，以下是最近更新：`,
      normalizeListText({ list: deduped.slice(0, 5) }, '')
    ].filter(Boolean).join('\n')
  }
}
