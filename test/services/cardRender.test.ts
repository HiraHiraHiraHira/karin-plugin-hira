import { describe, expect, it, vi } from 'vitest'

import {
  buildErrorCardHtml,
  buildHelpCardHtml,
  buildMusicListCardHtml,
  buildXiaohongshuPreviewCardHtml,
  buildXiaoheihePreviewCardHtml,
  buildResolverPreviewCardHtml,
  buildResolverCardHtml,
  buildStatusCardHtml,
  renderTemplateHtml,
  writeCardHtmlFile,
  renderCardImage
} from '@/services/cardRender'

describe('cardRender', () => {
  it('renders cards through a reusable react template document', () => {
    const html = renderTemplateHtml({
      hero: 'TEST',
      eyebrow: 'TEMPLATE.SYSTEM',
      title: '模板测试',
      subtitle: 'React 渲染层',
      watermark: 'SPEC',
      body: '<section data-testid="body">ok</section>'
    })

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('data-template-engine="react-static"')
    expect(html).toContain('hira-render-shell')
    expect(html).toContain('TEMPLATE.SYSTEM')
    expect(html).toContain('模板测试')
    expect(html).toContain('<section data-testid="body">ok</section>')
  })

  it('builds a kkk-inspired grouped help card instead of plain help text', () => {
    const html = buildHelpCardHtml([
      {
        title: '常用功能',
        items: [
          { title: '#点歌 <关键词>', description: '使用默认音乐源点歌', icon: '♪' },
          { title: '自动识别分享链接', description: '按配置解析支持的平台链接', icon: '↗' }
        ]
      },
      {
        title: '多平台解析',
        subGroups: [
          {
            title: '关闭 KKK 兼容后接管',
            items: [
              { title: '抖音 / B站 / 小红书', description: '由 Hira 尝试解析' }
            ]
          }
        ],
        items: [
          { title: '抖音 / B站 / 小红书', description: '关闭 KKK 兼容后由 Hira 接管' }
        ]
      }
    ])

    expect(html).toContain('hira-render-shell')
    expect(html).toContain('SYSTEM_READY')
    expect(html).toContain('COMMANDS')
    expect(html).toContain('CURRENT MODULE')
    expect(html).toContain('插件帮助')
    expect(html).toContain('command-grid')
    expect(html).toContain('command-icon')
    expect(html).toContain('关闭 KKK 兼容后接管')
    expect(html).toContain('常用功能')
    expect(html).toContain('#点歌 &lt;关键词&gt;')
    expect(html).toContain('多平台解析')
    expect(html).not.toContain('Hira：')
  })

  it('builds a music pick card with numbered rows', () => {
    const html = buildMusicListCardHtml([
      {
        title: '晴天',
        artists: '周杰伦',
        duration: '4:29'
      },
      {
        title: '稻香',
        artists: '周杰伦',
        duration: '3:43'
      }
    ], 1)

    expect(html).toContain('hira-render-shell')
    expect(html).toContain('SEARCH.RESULTS')
    expect(html).toContain('点歌列表')
    expect(html).toContain('music-row')
    expect(html).toContain('music-index')
    expect(html).toContain('第 1 页')
    expect(html).toContain('晴天')
    expect(html).toContain('周杰伦')
    expect(html).toContain('发送序号点歌')
  })

  it('builds status cards for derivative status-like replies', () => {
    const html = buildStatusCardHtml({
      title: '运行状态',
      subtitle: '插件开关与解析配置',
      eyebrow: 'SYSTEM.STATUS',
      items: [
        { label: '点歌', value: '开启', detail: '默认源：QQ音乐', status: 'ok' },
        { label: '多平台解析', value: '关闭', detail: 'KKK 兼容：开启', status: 'off' },
        { label: 'ffmpeg', value: 'ffmpeg', detail: '用于合并 B站 DASH', status: 'info' }
      ]
    })

    expect(html).toContain('SYSTEM.STATUS')
    expect(html).toContain('STATUS')
    expect(html).toContain('运行状态')
    expect(html).toContain('status-grid')
    expect(html).toContain('status-pill status-ok')
    expect(html).toContain('status-pill status-off')
    expect(html).toContain('用于合并 B站 DASH')
  })

  it('builds a resolver result card with platform, title, counts, and source url', () => {
    const html = buildResolverCardHtml({
      platform: 'weibo',
      displayName: '微博',
      title: '一条微博',
      description: '这是一段解析内容',
      author: 'Hira',
      pageUrl: 'https://weibo.com/123/abc',
      images: ['https://img/1.jpg', 'https://img/2.jpg'],
      videos: ['D:/tmp/video.mp4']
    })

    expect(html).toContain('RESOLVER.RESULT')
    expect(html).toContain('解析结果')
    expect(html).toContain('微博')
    expect(html).toContain('一条微博')
    expect(html).toContain('Hira')
    expect(html).toContain('图片')
    expect(html).toContain('2')
    expect(html).toContain('视频')
    expect(html).toContain('1')
    expect(html).toContain('https://weibo.com/123/abc')
  })

  it('builds a kkk-like light Xiaoheihe preview card without generic resolver chrome', () => {
    const html = buildXiaoheihePreviewCardHtml({
      platform: 'xiaoheihe',
      displayName: '小黑盒帖子',
      title: '图文混排帖子',
      description: '正文第一段内容预览，后续图文按原文顺序进入合并转发。',
      author: 'Hira',
      pageUrl: 'https://www.xiaoheihe.cn/app/bbs/link/abc123',
      images: ['https://img/cover.jpg', 'https://img/a.jpg'],
      videos: ['https://cdn.example.test/xhh.mp4'],
      extras: {
        tags: ['Steam', 'AI'],
        coverUrl: 'https://img/cover.jpg',
        authorAvatar: 'https://img/avatar.jpg',
        location: '上海',
        commentBlocks: [{ author: '路人', text: '评论', images: [] }]
      }
    })

    expect(html).toContain('resolver-preview-shell')
    expect(html).toContain('小黑盒帖子')
    expect(html).toContain('图文混排帖子')
    expect(html).toContain('Hira')
    expect(html).toContain('正文第一段内容预览')
    expect(html).toContain('#Steam')
    expect(html).toContain('#AI')
    expect(html).toContain('2 张图片')
    expect(html).toContain('1 个视频')
    expect(html).toContain('1 条评论')
    expect(html).toContain('padding: 8px;')
    expect(html).toContain('box-shadow: none;')
    expect((html.match(/border-radius: 8px;/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('padding: 24px;')
    expect(html).not.toContain('0 20px 46px')
    expect(html).not.toContain('border-radius: 20px;')
    expect(html).not.toContain('border-radius: 18px;')
    expect(html).not.toContain('RESOLVE')
    expect(html).not.toContain('resolver-metrics')
    expect(html).not.toContain('https://www.xiaoheihe.cn/app/bbs/link/abc123')
  })

  it('omits comment counts from resolver preview cards when comments are disabled', () => {
    const html = buildResolverPreviewCardHtml({
      platform: 'weibo',
      displayName: '微博',
      title: '微博标题',
      description: '微博正文\n\n热门评论\n路人：评论',
      images: ['https://img/cover.jpg'],
      videos: [],
      extras: {
        commentBlocks: [{ author: '路人', text: '评论', images: [] }]
      }
    }, undefined, { commentsEnabled: false })

    expect(html).not.toContain('1 条评论')
    expect(html).toContain('微博正文')
    expect(html).not.toContain('热门评论')
    expect(html).not.toContain('路人：评论')
  })

  it('builds a kkk-like light Xiaohongshu preview card from the shared resolver template', () => {
    const html = buildXiaohongshuPreviewCardHtml({
      platform: 'xiaohongshu',
      displayName: '小红书笔记',
      title: '周末咖啡路线',
      description: '第一家店的拿铁很稳，第二家适合拍照，图文顺序会进入合并转发。',
      author: 'Hira',
      pageUrl: 'https://www.xiaohongshu.com/explore/abc123',
      images: ['https://img/cover.jpg', 'https://img/a.jpg'],
      videos: [],
      extras: {
        coverUrl: 'https://img/cover.jpg',
        authorAvatar: 'https://img/avatar.jpg',
        tags: ['咖啡', '周末']
      }
    })

    expect(html).toContain('resolver-preview-shell')
    expect(html).toContain('小红书笔记')
    expect(html).toContain('周末咖啡路线')
    expect(html).toContain('Hira')
    expect(html).toContain('第一家店的拿铁很稳')
    expect(html).toContain('#咖啡')
    expect(html).toContain('#周末')
    expect(html).toContain('2 张图片')
    expect(html).toContain('padding: 8px;')
    expect(html).toContain('box-shadow: none;')
    expect((html.match(/border-radius: 8px;/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('RESOLVE')
    expect(html).not.toContain('resolver-metrics')
    expect(html).not.toContain('https://www.xiaohongshu.com/explore/abc123')
  })

  it('uses one shared light resolver preview skeleton for Xiaoheihe, Xiaohongshu, Weibo, and Tieba', () => {
    const platforms = [
      ['xiaoheihe', '小黑盒帖子'],
      ['xiaohongshu', '小红书笔记'],
      ['weibo', '微博'],
      ['tieba', '贴吧']
    ] as const

    for (const [platform, displayName] of platforms) {
      const html = buildResolverPreviewCardHtml({
        platform,
        displayName,
        title: `${displayName}标题`,
        description: `${displayName}摘要`,
        author: '作者',
        pageUrl: `https://example.test/${platform}`,
        images: ['https://img/cover.jpg'],
        videos: [],
        extras: {
          coverUrl: 'https://img/cover.jpg',
          tags: ['tag']
        }
      })

      expect(html).toContain('resolver-preview-shell')
      expect(html).toContain(`data-platform="${platform}"`)
      expect(html).toContain('resolver-preview-cover')
      expect(html).toContain(`${displayName}标题`)
      expect(html).toContain(`${displayName}摘要`)
      expect(html).toContain('#tag')
      expect(html).toContain('box-shadow: none;')
      expect(html).not.toContain('RESOLVE')
      expect(html).not.toContain('resolver-metrics')
      expect(html).not.toContain(`https://example.test/${platform}`)
    }
  })

  it('skips blurred or mosaic preview covers and hides the cover area when no usable image exists', () => {
    const html = buildResolverPreviewCardHtml({
      platform: 'xiaohongshu',
      displayName: '小红书笔记',
      title: '标题',
      description: '摘要',
      images: [
        'https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50',
        'https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp'
      ],
      videos: [],
      extras: {
        coverUrl: 'https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50'
      }
    })

    expect(html).toContain('https://sns-img-qc.xhscdn.com/a.jpg?imageView2/2/w/1080/format/webp')
    expect(html).not.toContain('https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50')

    const noCoverHtml = buildResolverPreviewCardHtml({
      platform: 'xiaohongshu',
      displayName: '小红书笔记',
      title: '标题',
      description: '摘要',
      images: ['https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50'],
      videos: [],
      extras: {
        coverUrl: 'https://sns-img-qc.xhscdn.com/a.jpg?imageMogr2/blur/50x50'
      }
    })

    expect(noCoverHtml).toContain('resolver-preview-main-no-cover')
    expect(noCoverHtml).not.toContain('<img class="resolver-preview-cover"')
  })

  it('builds an error diagnostic card without leaking raw html', () => {
    const html = buildErrorCardHtml({
      title: '解析失败',
      subtitle: '微博',
      reason: '<script>alert(1)</script>',
      suggestion: '检查 Cookie 或稍后重试。',
      details: ['接口返回 403', '触发命令：微博链接']
    })

    expect(html).toContain('SYSTEM.ERROR')
    expect(html).toContain('诊断卡片')
    expect(html).toContain('解析失败')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('接口返回 403')
    expect(html).toContain('检查 Cookie 或稍后重试。')
  })

  it('renders card html to a base64 image element', async () => {
    const render = vi.fn(async () => Buffer.from('image-bytes').toString('base64'))
    const writeHtml = vi.fn(() => 'D:\\tmp\\hira-card.html')

    const result = await renderCardImage({
      name: 'help',
      html: '<main id="container">ok</main>',
      width: 760,
      writeHtml,
      render
    })

    expect(writeHtml).toHaveBeenCalledWith('<main id="container">ok</main>', 'help')
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      name: 'karin-plugin-hira/card-help',
      file: 'D:\\tmp\\hira-card.html',
      selector: '#container',
      type: 'png'
    }))
    expect(result).toEqual([{ type: 'image', file: `base64://${Buffer.from('image-bytes').toString('base64')}` }])
  })

  it('writes card html into Karin html cache like kkk render output', () => {
    const file = writeCardHtmlFile('<main id="container">ok</main>', 'help')

    expect(file.replace(/\\/g, '/')).toContain('/temp/html/karin-plugin-hira/card-help/')
    expect(file).toMatch(/\.html$/)
  })
})
