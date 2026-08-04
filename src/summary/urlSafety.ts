import dns from 'node:dns/promises'
import net from 'node:net'

import { readResponseBytes } from '@/services/http'

const maxRedirects = 5
const maxPageBytes = 2 * 1024 * 1024
const pageTimeoutMs = 20_000
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const ipv4ToNumber = (address: string) => address.split('.').reduce((total, part) => total * 256 + Number(part), 0)

const isBlockedIpv4 = (address: string) => {
  const value = ipv4ToNumber(address)
  const ranges: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ]
  return ranges.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix)
    return value >= ipv4ToNumber(base) && value < ipv4ToNumber(base) + size
  })
}

const expandIpv6 = (address: string) => {
  const clean = address.toLowerCase().split('%')[0]
  const halves = clean.split('::')
  if (halves.length > 2) return undefined
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : []
  const tail = halves[1] ? halves[1].split(':').filter(Boolean) : []
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return undefined
  const parts = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return undefined
  return parts.map(part => Number.parseInt(part, 16))
}

const isBlockedIpv6 = (address: string) => {
  const parts = expandIpv6(address)
  if (!parts) return true
  const isZeroPrefix = parts.slice(0, 7).every(part => part === 0)
  if (isZeroPrefix && (parts[7] === 0 || parts[7] === 1)) return true
  const first = parts[0]
  if ((first & 0xfe00) === 0xfc00) return true // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true // documentation range

  const mapped = parts.slice(0, 5).every(part => part === 0) && parts[5] === 0xffff
  if (mapped) {
    const ipv4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`
    return isBlockedIpv4(ipv4)
  }
  return false
}

const isBlockedAddress = (address: string) => {
  const family = net.isIP(address)
  if (family === 4) return isBlockedIpv4(address)
  if (family === 6) return isBlockedIpv6(address)
  return true
}

const validateHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === 'metadata'
    || normalized === 'metadata.google.internal'
    || normalized.endsWith('.internal')
    || normalized.endsWith('.local')
  ) throw new Error('网页地址指向受限主机')
}

export const validatePublicUrl = async (input: string) => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('网页地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('网页地址只允许 http 或 https')
  if (url.username || url.password) throw new Error('网页地址不能包含账号密码')

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  validateHostname(hostname)
  if (isBlockedAddress(hostname)) throw new Error('网页地址指向受限地址')

  if (net.isIP(hostname) === 0) {
    let records: Array<{ address: string }>
    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true })
    } catch {
      throw new Error('网页地址无法解析')
    }
    if (records.length === 0 || records.some(record => isBlockedAddress(record.address))) {
      throw new Error('网页地址解析到了受限地址')
    }
  }

  return url
}

const isRedirect = (status: number) => status >= 300 && status < 400

const isAllowedPageContent = (response: Response) => {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!contentType) return true
  return contentType === 'text/html'
    || contentType === 'application/xhtml+xml'
    || contentType === 'text/plain'
    || contentType.startsWith('text/')
}

export const fetchPublicPageText = async (input: string) => {
  let current = (await validatePublicUrl(input)).toString()

  for (let count = 0; count <= maxRedirects; count++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), pageTimeoutMs)
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': userAgent },
        signal: controller.signal
      })
      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error(`网页重定向缺少目标地址（HTTP ${response.status}）`)
        current = (await validatePublicUrl(new URL(location, current).toString())).toString()
        await response.body?.cancel()
        continue
      }
      if (!response.ok) throw new Error(`网页请求失败：HTTP ${response.status}`)
      if (!isAllowedPageContent(response)) throw new Error('目标地址不是可总结的文本网页')

      const bytes = await readResponseBytes(response, maxPageBytes)
      return bytes.toString('utf8')
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('网页重定向次数超过限制')
}
