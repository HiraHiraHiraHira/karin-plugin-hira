import type { ResolverMatch } from './types'
import { hostnameOf } from './url'

type Rule = {
  platform: ResolverMatch['platform']
  displayName: string
  test: (url: string, hostname: string) => boolean
}

const rules: Rule[] = [
  {
    platform: 'bilibili',
    displayName: '哔哩哔哩',
    test: (_url, hostname) => ['bilibili.com', 'b23.tv', 'bili2233.cn']
      .some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  },
  {
    platform: 'douyin',
    displayName: '抖音',
    test: (_url, hostname) => ['douyin.com', 'iesdouyin.com']
      .some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  },
  {
    platform: 'kuaishou',
    displayName: '快手',
    test: (_url, hostname) => ['kuaishou.com', 'chenzhongtech.com']
      .some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  },
  {
    platform: 'xiaohongshu',
    displayName: '小红书',
    test: (_url, hostname) => ['xiaohongshu.com', 'xhslink.com']
      .some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  },
  {
    platform: 'weibo',
    displayName: '微博',
    test: (_url, hostname) => hostname === 'weibo.com' || hostname.endsWith('.weibo.com')
  },
  {
    platform: 'tieba',
    displayName: '贴吧',
    test: (url, hostname) => hostname === 'tieba.baidu.com' && /\/p\/\d+/i.test(url)
  },
  {
    platform: 'xiaoheihe',
    displayName: '小黑盒',
    test: (_url, hostname) => hostname === 'xiaoheihe.cn' || hostname.endsWith('.xiaoheihe.cn')
  },
  {
    platform: 'general',
    displayName: '通用解析',
    test: (_url, hostname) => [
      'ixigua.com',
      'pipix.com',
      'pipigx.com',
      'xsj.qq.com',
      'okjike.com'
    ].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
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
