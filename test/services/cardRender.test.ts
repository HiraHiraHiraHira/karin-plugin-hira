import { describe, expect, it, vi } from 'vitest'

import {
  buildHelpCardHtml,
  buildMusicListCardHtml,
  buildStatusCardHtml,
  writeCardHtmlFile,
  renderCardImage
} from '@/services/cardRender'

describe('cardRender', () => {
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
