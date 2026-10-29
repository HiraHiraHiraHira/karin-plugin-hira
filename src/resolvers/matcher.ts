import type { ResolverMatch, ResolverPlatform } from './types'
import { hostnameOf } from './url'

/**
 * 平台域名唯一数据源：匹配规则与命令层正则都从这里派生。
 * 新增平台只需在 `ResolverPlatform` 与这里各加一项，不再有三处重复列表。
 */
export const PLATFORM_DOMAINS: Record<ResolverPlatform, readonly string[]> = {
  bilibili: ['bilibili.com', 'b23.tv', 'bili2233.cn'],
  douyin: ['douyin.com', 'iesdouyin.com'],
  kuaishou: ['kuaishou.com', 'chenzhongtech.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn'],
  weibo: ['weibo.com', 'weibo.cn'],
  tieba: ['tieba.baidu.com'],
  xiaoheihe: ['xiaoheihe.cn'],
  general: ['ixigua.com', 'pipix.com', 'pipigx.com', 'xsj.qq.com', 'okjike.com', 'acfun.cn']
}

/** 命令层正则复用的域名表；顺序与 `PLATFORM_DOMAINS` 的插入顺序一致。 */
export const RESOLVER_DOMAINS: readonly string[] = Object.values(PLATFORM_DOMAINS).flat()

export const RESOLVER_DOMAIN_PATTERN = RESOLVER_DOMAINS
  .map(domain => domain.replace(/\./g, '\\.'))
  .join('|')

type Rule = {
  platform: ResolverMatch['platform']
  displayName: string
  test: (url: string, hostname: string) => boolean
}

/** 精确域名或子域名命中：`b23.tv` 不会误配 `evil-b23.tv`。 */
const matchesDomain = (hostname: string, platform: ResolverPlatform) =>
  PLATFORM_DOMAINS[platform].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))

const rules: Rule[] = [
  {
    platform: 'bilibili',
    displayName: '哔哩哔哩',
    test: (_url, hostname) => matchesDomain(hostname, 'bilibili')
  },
  {
    platform: 'douyin',
    displayName: '抖音',
    test: (_url, hostname) => matchesDomain(hostname, 'douyin')
  },
  {
    platform: 'kuaishou',
    displayName: '快手',
    test: (_url, hostname) => matchesDomain(hostname, 'kuaishou')
  },
  {
    platform: 'xiaohongshu',
    displayName: '小红书',
    test: (_url, hostname) => matchesDomain(hostname, 'xiaohongshu')
  },
  {
    platform: 'weibo',
    displayName: '微博',
    test: (_url, hostname) => matchesDomain(hostname, 'weibo')
  },
  {
    platform: 'tieba',
    displayName: '贴吧',
    // 贴吧域名本身还有吧首页等非帖子链接，只有 `/p/<id>` 才是可解析的帖子。
    test: (url, hostname) => matchesDomain(hostname, 'tieba') && /\/p\/\d+/i.test(url)
  },
  {
    platform: 'xiaoheihe',
    displayName: '小黑盒',
    test: (_url, hostname) => matchesDomain(hostname, 'xiaoheihe')
  },
  {
    platform: 'general',
    displayName: '通用解析',
    test: (_url, hostname) => matchesDomain(hostname, 'general')
  }
]

export const matchResolver = (url: string): ResolverMatch | undefined => {
  const hostname = hostnameOf(url)
  if (!hostname) return undefined

  const rule = rules.find(item => item.test(url, hostname))
  if (!rule) return undefined

  return {
    platform: rule.platform,
    displayName: rule.displayName,
    url
  }
}
