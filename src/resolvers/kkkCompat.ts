import { hostnameOf } from './url'

const kkkDomains = [
  'douyin.com',
  'iesdouyin.com',
  'bilibili.com',
  'b23.tv',
  'bili2233.cn',
  'kuaishou.com',
  'xiaohongshu.com',
  'xhslink.com'
]

export const shouldSkipForKkkCompat = (url: string, kkkCompat: boolean) => {
  if (!kkkCompat) return false

  const hostname = hostnameOf(url)
  if (!hostname) return false

  return kkkDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

export const kkkCompatDomains = [...kkkDomains]
