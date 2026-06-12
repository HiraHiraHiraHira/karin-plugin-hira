export type LightCommand =
  | { type: 'cat' }
  | { type: 'buyerShow' }
  | { type: 'tired' }
  | { type: 'medicine', keyword: string }
  | { type: 'software', keyword: string }
  | { type: 'none' }

export const parseLightCommand = (message: string): LightCommand => {
  const msg = message.trim()
  if (/^#?cat$/i.test(msg)) return { type: 'cat' }
  if (/^#?买家秀$/.test(msg)) return { type: 'buyerShow' }
  if (/^#?累了$/.test(msg)) return { type: 'tired' }

  const medicine = msg.match(/^#?医药查询\s+(.+)$/)
  if (medicine?.[1]?.trim()) return { type: 'medicine', keyword: medicine[1].trim() }

  const software = msg.match(/^#?推荐软件\s+(.+)$/)
  if (software?.[1]?.trim()) return { type: 'software', keyword: software[1].trim() }

  return { type: 'none' }
}
