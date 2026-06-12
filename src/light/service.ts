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

export const getCatImage = () => fetchFirstImage(Config.light.catApis, '猫图')

export const getBuyerShowImage = () => fetchFirstImage(Config.light.buyerShowApis, '买家秀')

export const getTiredImage = () => fetchFirstImage(Config.light.tiredApis, '累了')

const normalizeListText = (payload: unknown, emptyText: string) => {
  const root = payload as Record<string, unknown>
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

export const queryMedicine = async (keyword: string): Promise<LightResult> => {
  const url = Config.light.medicineApi.replace('{keyword}', encodeURIComponent(keyword))
  const payload = await fetchJson<unknown>(url)
  return {
    type: 'text',
    title: '医药查询',
    text: normalizeListText(payload, '未找到相关医药信息')
  }
}

export const querySoftware = async (keyword: string): Promise<LightResult> => {
  const url = Config.light.softwareApi.replace('{keyword}', encodeURIComponent(keyword))
  const payload = await fetchJson<unknown>(url)
  return {
    type: 'text',
    title: '推荐软件',
    text: normalizeListText(payload, '未找到相关软件')
  }
}
