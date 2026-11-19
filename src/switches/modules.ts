/**
 * 群级功能开关的模块定义。
 *
 * 命令词与存储用的 id 分开：id 稳定（写进 data/group-switches.json），
 * 别名只是聊天里能打出来的词。新增模块时只在 `modules` 里加一条，
 * 命令解析、`#开关` 状态、控制器判定都会自动带上。
 */

export type SwitchModule = {
  /** 存储与代码内部使用的稳定标识 */
  id: string
  /** 状态列表、开关回执里显示的名字 */
  label: string
  /** 聊天里可用的命令词（不含开关动词） */
  aliases: string[]
  /** 上位模块：上位被关时自己也算关闭，用于「解析全关」和单平台细关并存 */
  parent?: string
}

/**
 * 顺序即 `#开关` 状态列表顺序。
 *
 * 解析拆成「平台级」而不是一个整体：群里往往只想关抖音，不想关 B站。
 * `resolve` 作为上位模块保留，`#解析关闭` 一次关掉下面全部平台。
 */
export const switchModules: SwitchModule[] = [
  { id: 'music', label: '点歌', aliases: ['点歌', '音乐', '点歌功能'] },
  { id: 'resolve', label: '解析（全部平台）', aliases: ['解析', '链接解析', '解析功能'] },
  { id: 'resolve:bilibili', label: 'B站解析', aliases: ['B站', 'b站', '哔哩哔哩', '哔哩', 'bilibili'], parent: 'resolve' },
  { id: 'resolve:douyin', label: '抖音解析', aliases: ['抖音', 'douyin'], parent: 'resolve' },
  { id: 'resolve:kuaishou', label: '快手解析', aliases: ['快手', 'kuaishou'], parent: 'resolve' },
  { id: 'resolve:xiaohongshu', label: '小红书解析', aliases: ['小红书', 'xhs', 'xiaohongshu'], parent: 'resolve' },
  { id: 'resolve:weibo', label: '微博解析', aliases: ['微博', 'weibo'], parent: 'resolve' },
  { id: 'resolve:tieba', label: '贴吧解析', aliases: ['贴吧', 'tieba'], parent: 'resolve' },
  { id: 'resolve:xiaoheihe', label: '小黑盒解析', aliases: ['小黑盒', 'xiaoheihe'], parent: 'resolve' },
  { id: 'resolve:general', label: '通用解析', aliases: ['通用解析', '通用', '其他平台'], parent: 'resolve' },
  { id: 'light', label: '轻量功能', aliases: ['轻量', '轻量功能'], parent: 'light' },
  { id: 'light:fun', label: '娱乐（猫图/买家秀/累了）', aliases: ['娱乐', '猫图', '买家秀', '累了'], parent: 'light' },
  { id: 'light:query', label: '查询（医药/软件）', aliases: ['查询', '医药', '医药查询', '推荐软件'], parent: 'light' },
  { id: 'translate', label: '翻译', aliases: ['翻译', 'translate'], parent: 'translate' },
  { id: 'summary', label: 'AI 总结', aliases: ['总结', 'AI总结', 'ai总结', '网页总结'], parent: 'summary' }
]

/** 命令里可用的「关」动词，长的在前，保证 `打开` 不会被 `开` 抢先切掉。 */
export const offVerbs = ['关闭', '禁用', '停用', '关掉', '关']
export const onVerbs = ['开启', '启用', '打开', '开']

/** 模块 id → 定义 */
export const moduleById = new Map(switchModules.map(module => [module.id, module]))

/** 命令词（小写）→ 模块 id；同一命令词只允许指向一个模块 */
export const moduleByAlias = new Map<string, string>()
for (const module of switchModules) {
  for (const alias of module.aliases) moduleByAlias.set(alias.toLowerCase(), module.id)
}

/** 全部可关闭的叶子模块（不含上位模块），`#全部开关` 用 */
export const leafModuleIds = switchModules
  .filter(module => !switchModules.some(child => child.parent === module.id))
  .map(module => module.id)

/** 含上位模块的全部 id */
export const allModuleIds = switchModules.map(module => module.id)
