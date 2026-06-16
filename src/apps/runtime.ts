import { Config } from '@/config'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const configuredCommandToPattern = (command: string) => {
  const normalized = command.trim().replace(/^#/, '')
  if (!normalized) return undefined
  return escapeRegExp(normalized).replace(/\\ /g, '\\s*')
}

export const createConfiguredCommandRegExp = (command: string, aliases: string[]) => {
  const patterns = [
    configuredCommandToPattern(command),
    ...aliases
  ].filter(Boolean)

  return new RegExp(`^#?(?:${patterns.join('|')})$`, 'i')
}

export const isHiraAppEnabled = () => Config.app.enabled
