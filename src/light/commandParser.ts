export type LightCommand =
  | { type: 'cat' }
  | { type: 'buyerShow' }
  | { type: 'tired' }
  | { type: 'medicine', keyword: string }
  | { type: 'software', keyword: string }
  | { type: 'none' }

/** `#医药查询` / `#推荐软件` 允许空关键词（R query.js 原样请求全部）。 */
export const parseLightCommand = (message: string): LightCommand => {
  const msg = message.trim()
  if (/^#?cat$/i.test(msg)) return { type: 'cat' }
  if (/^#?买家秀$/.test(msg)) return { type: 'buyerShow' }
  if (/^#?累了$/.test(msg)) return { type: 'tired' }

  const medicine = msg.match(/^#?医药查询(?:\s+([\s\S]*))?$/)
  if (medicine) return { type: 'medicine', keyword: (medicine[1] ?? '').trim() }

  const software = msg.match(/^#?推荐软件(?:\s+([\s\S]*))?$/)
  if (software) return { type: 'software', keyword: (software[1] ?? '').trim() }

  return { type: 'none' }
}

/** 与 parseLightCommand 同口径，供 karin.command 匹配（裸命令也是有效命令）。 */
export const lightCommandReg = /^#?(?:cat|买家秀|累了|医药查询(?:\s+[\s\S]+)?|推荐软件(?:\s+[\s\S]+)?)$/i
