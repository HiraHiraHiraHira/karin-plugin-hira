import { accordion, accordionItem, input, select, switchComponent } from 'node-karin'
import type { ComponentConfig } from 'node-karin'

import { readAllConfig } from '@/config'

export const webFieldPathMap: Record<string, string> = {
  appEnabled: 'app.enabled',
  appReplyPrefix: 'app.replyPrefix',
  appHelpCommand: 'app.helpCommand',
  appStatusCommand: 'app.statusCommand',
  musicEnabled: 'music.enabled',
  musicDefaultSource: 'music.defaultSource',
  musicListModeDefault: 'music.listModeDefault',
  musicHighQuality: 'music.highQuality',
  musicVoiceEnabled: 'music.voiceEnabled',
  musicPageSize: 'music.pageSize',
  musicSessionTtlSeconds: 'music.sessionTtlSeconds',
  musicCookiesNetease: 'music.cookies.netease',
  musicCookiesQq: 'music.cookies.qq',
  musicCookiesBilibili: 'music.cookies.bilibili',
  resolverEnabled: 'resolver.enabled',
  resolverKkkCompat: 'resolver.kkkCompat',
  resolverPriority: 'resolver.priority',
  resolverBilibiliMaxVideoDurationMinutes: 'resolver.bilibili.maxVideoDurationSeconds',
  resolverBilibiliMaxVideoDurationSeconds: 'resolver.bilibili.maxVideoDurationSeconds',
  resolverBilibiliQuality: 'resolver.bilibili.quality',
  resolverBilibiliCodec: 'resolver.bilibili.codec',
  resolverDouyinMaxVideoDurationMinutes: 'resolver.douyin.maxVideoDurationSeconds',
  resolverDouyinMaxVideoDurationSeconds: 'resolver.douyin.maxVideoDurationSeconds',
  resolverDouyinQuality: 'resolver.douyin.quality',
  resolverProxy: 'resolver.proxy',
  resolverCookiesWeibo: 'resolver.cookies.weibo',
  resolverCookiesXiaoheihe: 'resolver.cookies.xiaoheihe',
  resolverCookiesDouyin: 'resolver.cookies.douyin',
  resolverCookiesXiaohongshu: 'resolver.cookies.xiaohongshu',
  resolverCookiesBilibili: 'resolver.cookies.bilibili',
  runtimeTempRoot: 'runtime.tempRoot',
  runtimeCleanupEnabled: 'runtime.cleanupEnabled',
  runtimeCleanupMaxAgeMinutes: 'runtime.cleanupMaxAgeMinutes',
  runtimeFfmpegPath: 'runtime.ffmpegPath',
  runtimeFfprobePath: 'runtime.ffprobePath',
  lightEnabled: 'light.enabled',
  translateEnabled: 'translate.enabled',
  translateDeeplxApi: 'translate.deeplxApi',
  aiSummaryEnabled: 'ai.summaryEnabled',
  aiApiBaseUrl: 'ai.apiBaseUrl',
  aiModel: 'ai.model',
  aiApiKey: 'ai.apiKey'
}

const sourceItems = [
  select.createItem('netease', { label: '网易云', value: 'netease' }),
  select.createItem('qq', { label: 'QQ音乐', value: 'qq' }),
  select.createItem('kuwo', { label: '酷我', value: 'kuwo' }),
  select.createItem('kugou', { label: '酷狗', value: 'kugou' }),
  select.createItem('bilibili', { label: '哔哩哔哩', value: 'bilibili' })
]

const bilibiliQualityItems = [
  select.createItem('16', { label: '360P 流畅', value: '16' }),
  select.createItem('32', { label: '480P 清晰', value: '32' }),
  select.createItem('64', { label: '720P 高清', value: '64' }),
  select.createItem('80', { label: '1080P 高清', value: '80' }),
  select.createItem('112', { label: '1080P+ 高码率', value: '112' }),
  select.createItem('116', { label: '1080P60 高帧率', value: '116' }),
  select.createItem('120', { label: '4K 超清', value: '120' })
]

const bilibiliCodecItems = [
  select.createItem('auto', { label: '自动选择', value: 'auto' }),
  select.createItem('avc', { label: 'AVC/H.264 兼容', value: 'avc' }),
  select.createItem('hevc', { label: 'HEVC/H.265', value: 'hevc' }),
  select.createItem('av1', { label: 'AV1', value: 'av1' })
]

const douyinQualityItems = [
  select.createItem('adapt', { label: '自动选择', value: 'adapt' }),
  select.createItem('540p', { label: '标清 540p', value: '540p' }),
  select.createItem('720p', { label: '高清 720p', value: '720p' }),
  select.createItem('1080p', { label: '高清 1080p', value: '1080p' }),
  select.createItem('2k', { label: '超清 2K', value: '2k' }),
  select.createItem('4k', { label: '超清 4K', value: '4k' })
]

const createSwitch = (key: string, label: string, defaultSelected: boolean, description?: string) => switchComponent.create(key, {
  label,
  description,
  startText: '开启',
  endText: '关闭',
  size: 'md',
  color: 'primary',
  defaultSelected,
  isReadOnly: false,
  isDisabled: false,
  disableAnimation: false
})

const createOptionalStringInput = (key: string, label: string, defaultValue: string, description?: string) => input.string(key, {
  label,
  description,
  defaultValue,
  isRequired: false
})

const secondsToMinutesValue = (seconds: number | string) => {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return '0'
  return String(value / 60)
}

export const createWebConfigComponents = (): ComponentConfig[] => {
  const config = readAllConfig()

  return [
    accordion.create('hiraConfig', {
      label: 'Hira 插件配置',
      title: 'Hira 插件配置',
      variant: 'splitted',
      selectionMode: 'multiple',
      selectionBehavior: 'toggle',
      showDivider: false,
      keepContentMounted: true,
      defaultSelectedKeys: ['hiraApp', 'hiraMusic', 'hiraResolver', 'hiraRuntime', 'hiraExtra'],
      children: [
        accordionItem.create('hiraApp', {
          title: '基础设置',
          subtitle: '管理插件总开关、帮助命令和常规回复前缀。',
          children: [
            createSwitch('appEnabled', '启用插件', config.app.enabled, '关闭后 Hira 不再处理已注册的功能命令。'),
            input.string('appReplyPrefix', { label: '回复前缀', description: '普通命令回复使用；多平台解析结果不会附加此前缀。', defaultValue: config.app.replyPrefix }),
            input.string('appHelpCommand', { label: '帮助命令', description: '用于展示插件帮助的主命令。', defaultValue: config.app.helpCommand }),
            input.string('appStatusCommand', { label: '状态命令', description: '用于查看插件运行状态的主命令。', defaultValue: config.app.statusCommand })
          ]
        }),
        accordionItem.create('hiraMusic', {
          title: '点歌设置',
          subtitle: '管理音乐源、列表模式、语音点歌和各平台 Cookie。',
          children: [
            createSwitch('musicEnabled', '启用点歌', config.music.enabled, '开启后响应点歌、歌词、语音和 B站音乐链接命令。'),
            select.create('musicDefaultSource', { label: '默认音乐源', description: '未指定平台时优先使用的搜索来源。', defaultValue: config.music.defaultSource, items: sourceItems }),
            createSwitch('musicListModeDefault', '默认列表模式', config.music.listModeDefault, '开启后普通点歌也先返回多选列表。'),
            createSwitch('musicHighQuality', '高品质点歌', config.music.highQuality, '支持的平台会尽量返回更高音质音频。'),
            createSwitch('musicVoiceEnabled', '启用语音点歌', config.music.voiceEnabled, '开启后可使用语音点歌相关命令。'),
            input.number('musicPageSize', { label: '每页数量', description: '多选点歌列表每页展示的歌曲数量。', defaultValue: String(config.music.pageSize), rules: [{ min: 1, max: 20 }] }),
            input.number('musicSessionTtlSeconds', { label: '会话有效期秒数', description: '多选列表保留多久可继续用序号选择。', defaultValue: String(config.music.sessionTtlSeconds), rules: [{ min: 30, max: 3600 }] }),
            createOptionalStringInput('musicCookiesNetease', '网易云 Cookie', config.music.cookies.netease, '可选，留空时使用公开接口能力。'),
            createOptionalStringInput('musicCookiesQq', 'QQ音乐 Cookie', config.music.cookies.qq, '可选，用于需要登录态的 QQ 音乐能力。'),
            createOptionalStringInput('musicCookiesBilibili', 'B站 Cookie', config.music.cookies.bilibili, '可选，用于 B站音乐链接解析。')
          ]
        }),
        accordionItem.create('hiraResolver', {
          title: '多平台解析',
          subtitle: '管理微博、贴吧、小黑盒、小红书、抖音、B站等分享链接解析。',
          children: [
            createSwitch('resolverEnabled', '启用多平台解析', config.resolver.enabled, '开启后自动识别支持的平台分享链接。'),
            createSwitch('resolverKkkCompat', 'KKK 兼容模式', config.resolver.kkkCompat, '开启时跳过 KKK 已覆盖的平台，关闭后由 Hira 接管更多平台。'),
            input.number('resolverPriority', { label: '解析优先级', description: '修改后需重启 Karin 才能完全生效。', defaultValue: String(config.resolver.priority), rules: [{ min: 0, max: 9999 }] }),
            input.number('resolverBilibiliMaxVideoDurationMinutes', { label: 'B站下载上限分钟', description: '超过上限仅返回视频信息；0 表示不限制。', defaultValue: secondsToMinutesValue(config.resolver.bilibili.maxVideoDurationSeconds), rules: [{ min: 0, max: 360 }] }),
            select.create('resolverBilibiliQuality', { label: 'B站下载画质', description: '控制 B站视频下载的最高画质。', defaultValue: String(config.resolver.bilibili.quality), items: bilibiliQualityItems }),
            select.create('resolverBilibiliCodec', { label: 'B站视频编码', description: '自动模式优先选择更省体积的现代编码；兼容性异常时可改为 AVC。', defaultValue: config.resolver.bilibili.codec, items: bilibiliCodecItems }),
            input.number('resolverDouyinMaxVideoDurationMinutes', { label: '抖音下载上限分钟', description: '超过上限仅返回作品信息；0 表示不限制。', defaultValue: secondsToMinutesValue(config.resolver.douyin.maxVideoDurationSeconds), rules: [{ min: 0, max: 360 }] }),
            select.create('resolverDouyinQuality', { label: '抖音视频清晰度', description: '控制抖音视频直链解析时请求的清晰度。', defaultValue: config.resolver.douyin.quality, items: douyinQualityItems }),
            createOptionalStringInput('resolverProxy', '代理地址', config.resolver.proxy, '可选，留空表示不使用代理。'),
            createOptionalStringInput('resolverCookiesWeibo', '微博 Cookie', config.resolver.cookies.weibo, '可选，用于提升微博解析成功率。'),
            createOptionalStringInput('resolverCookiesXiaoheihe', '小黑盒 Cookie', config.resolver.cookies.xiaoheihe, '可选，小黑盒部分帖子需要登录态。'),
            createOptionalStringInput('resolverCookiesDouyin', '抖音 Cookie', config.resolver.cookies.douyin, '可选，用于抖音原生解析。'),
            createOptionalStringInput('resolverCookiesXiaohongshu', '小红书 Cookie', config.resolver.cookies.xiaohongshu, '可选，小红书原生解析通常需要登录态。'),
            createOptionalStringInput('resolverCookiesBilibili', 'B站解析 Cookie', config.resolver.cookies.bilibili, '可选，用于 B站视频信息和高画质流获取。')
          ]
        }),
        accordionItem.create('hiraRuntime', {
          title: '运行时工具',
          subtitle: '管理临时目录、缓存清理和 ffmpeg/ffprobe 路径。',
          children: [
            createOptionalStringInput('runtimeTempRoot', '临时目录', config.runtime.tempRoot, '可选，留空时使用插件默认数据目录。'),
            createSwitch('runtimeCleanupEnabled', '自动清理临时文件', config.runtime.cleanupEnabled, '开启后定期删除过期下载缓存。'),
            input.number('runtimeCleanupMaxAgeMinutes', { label: '保留分钟数', description: '临时文件保留多久后可被清理。', defaultValue: String(config.runtime.cleanupMaxAgeMinutes), rules: [{ min: 1, max: 10080 }] }),
            input.string('runtimeFfmpegPath', { label: 'ffmpeg 路径', description: '用于合并 B站 DASH 视频和音频。', defaultValue: config.runtime.ffmpegPath }),
            input.string('runtimeFfprobePath', { label: 'ffprobe 路径', description: '预留给后续媒体信息检测。', defaultValue: config.runtime.ffprobePath })
          ]
        }),
        accordionItem.create('hiraExtra', {
          title: '轻量功能与 AI',
          subtitle: '管理轻量命令、翻译和网页总结能力。',
          children: [
            createSwitch('lightEnabled', '启用轻量命令', config.light.enabled, '开启后响应猫图、买家秀、医药查询等轻量命令。'),
            createSwitch('translateEnabled', '启用翻译', config.translate.enabled, '开启后响应翻中、翻英、翻日等翻译命令。'),
            createOptionalStringInput('translateDeeplxApi', 'DeepLX API', config.translate.deeplxApi, '可选，留空时不使用 DeepLX。'),
            createSwitch('aiSummaryEnabled', '启用网页总结', config.ai.summaryEnabled, '开启后可使用网页总结命令。'),
            input.string('aiApiBaseUrl', { label: 'AI API 地址', description: '兼容 OpenAI 接口格式的 API 地址。', defaultValue: config.ai.apiBaseUrl }),
            input.string('aiModel', { label: '总结模型', description: '用于网页总结的模型名称。', defaultValue: config.ai.model }),
            createOptionalStringInput('aiApiKey', 'AI API Key', config.ai.apiKey, '可选；启用网页总结时通常需要填写。')
          ]
        })
      ]
    })
  ]
}
