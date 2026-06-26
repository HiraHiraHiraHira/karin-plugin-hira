import fs from 'node:fs'
import path from 'node:path'
import {
  buildHelpCardHtml,
  buildMusicListCardHtml,
  buildStatusCardHtml,
  buildUpdateCardHtml,
  buildErrorCardHtml,
  type HelpCardGroup,
  type MusicListCardItem,
  type StatusCardOptions,
  type UpdateCardOptions,
  type ErrorCardOptions
} from '../src/services/cardRender'

/**
 * 视觉测试 - 生成所有卡片类型的 HTML 预览
 */
describe('Card Render Visual Test', () => {
  const outputDir = path.join(__dirname, '../test-output')

  beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
  })

  test('生成帮助卡片 HTML', () => {
    const groups: HelpCardGroup[] = [
      {
        title: '核心功能',
        items: [
          { title: '#help', description: '显示插件帮助信息，查看所有可用命令', icon: '?' },
          { title: '#点歌 [歌名]', description: '搜索并播放音乐，支持网易云、QQ音乐等平台' },
          { title: '#解析 [链接]', description: '解析社交媒体链接，支持B站、抖音、小红书等' },
          { title: '#翻译 [文本]', description: '多语言翻译，支持中英日韩等主流语言' }
        ]
      },
      {
        title: '系统管理',
        items: [
          { title: '#status', description: '查看插件运行状态和系统信息', icon: '📊' },
          { title: '#update', description: '检查并更新插件到最新版本', icon: '⬆️' }
        ]
      }
    ]

    const html = buildHelpCardHtml(groups)
    fs.writeFileSync(path.join(outputDir, 'help-card.html'), html)
    expect(html).toContain('HELP')
  })

  test('生成点歌列表卡片 HTML', () => {
    const items: MusicListCardItem[] = [
      { title: '夜曲', artists: '周杰伦', duration: '04:32' },
      { title: '七里香', artists: '周杰伦', duration: '05:05' },
      { title: '稻香', artists: '周杰伦', duration: '03:43' },
      { title: '晴天', artists: '周杰伦', duration: '04:29' },
      { title: '简单爱', artists: '周杰伦', duration: '04:30' }
    ]

    const html = buildMusicListCardHtml(items, 1)
    fs.writeFileSync(path.join(outputDir, 'music-list-card.html'), html)
    expect(html).toContain('MUSIC')
  })

  test('生成状态卡片 HTML', () => {
    const options: StatusCardOptions = {
      title: '插件状态',
      subtitle: '当前运行状态一览',
      items: [
        { label: '运行状态', value: '正常运行', detail: '已运行 2 天 5 小时', status: 'ok' },
        { label: 'Cookie 状态', value: '已配置', detail: '网易云音乐 Cookie 有效', status: 'ok' },
        { label: '解析服务', value: '6 个平台', detail: 'B站、抖音、小红书等', status: 'info' },
        { label: '错误次数', value: '3 次', detail: '最近 24 小时内', status: 'warn' }
      ]
    }

    const html = buildStatusCardHtml(options)
    fs.writeFileSync(path.join(outputDir, 'status-card.html'), html)
    expect(html).toContain('STATUS')
  })

  test('生成更新卡片 HTML - 可更新', () => {
    const options: UpdateCardOptions = {
      state: 'available',
      title: '发现新版本',
      subtitle: '插件有可用更新',
      current: 'v0.1.0',
      latest: 'v0.2.0',
      source: 'GitHub',
      lagCount: 5,
      details: [
        '新增小红书解析支持',
        '优化 B 站动态解析性能',
        '修复抖音视频下载问题',
        '改进错误处理机制',
        '更新依赖包到最新版本'
      ],
      tip: '建议及时更新以获得最佳体验'
    }

    const html = buildUpdateCardHtml(options)
    fs.writeFileSync(path.join(outputDir, 'update-card-available.html'), html)
    expect(html).toContain('UPDATE')
  })

  test('生成更新卡片 HTML - 已最新', () => {
    const options: UpdateCardOptions = {
      state: 'latest',
      title: '已是最新版本',
      current: 'v0.2.0',
      latest: 'v0.2.0',
      source: 'GitHub'
    }

    const html = buildUpdateCardHtml(options)
    fs.writeFileSync(path.join(outputDir, 'update-card-latest.html'), html)
    expect(html).toContain('已最新')
  })

  test('生成错误卡片 HTML', () => {
    const options: ErrorCardOptions = {
      title: 'Cookie 失效',
      subtitle: '网易云音乐',
      reason: '当前配置的 Cookie 已过期或无效，无法获取音乐资源',
      suggestion: '请重新配置有效的 Cookie，参考文档：https://example.com/docs',
      details: [
        'Error Code: 401',
        'Timestamp: 2024-06-26 10:30:45',
        'Endpoint: /api/song/url'
      ]
    }

    const html = buildErrorCardHtml(options)
    fs.writeFileSync(path.join(outputDir, 'error-card.html'), html)
    expect(html).toContain('ERROR')
  })

  test('所有测试 HTML 文件已生成', () => {
    const files = [
      'help-card.html',
      'music-list-card.html',
      'status-card.html',
      'update-card-available.html',
      'update-card-latest.html',
      'error-card.html'
    ]

    for (const file of files) {
      const filePath = path.join(outputDir, file)
      expect(fs.existsSync(filePath)).toBe(true)
    }
  })
})
