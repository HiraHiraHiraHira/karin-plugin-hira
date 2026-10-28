import fs from 'node:fs'
import path from 'node:path'

type PkgSpecFields = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const readRootPackageSpecFields = (cwd: string): PkgSpecFields | undefined => {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')
    if (!raw.includes('"dependencies"')) return undefined
    return JSON.parse(raw) as PkgSpecFields
  } catch {
    return undefined
  }
}

/**
 * 读取宿主 package.json 中该插件的依赖声明。
 * 仅当 package.json 确实声明了该依赖时才返回字符串，未声明返回 undefined。
 */
export const readPackageDependencySpec = (pluginName: string, cwd = process.cwd()) => {
  const pkg = readRootPackageSpecFields(cwd)
  if (!pkg) return undefined
  return pkg.dependencies?.[pluginName] ||
    pkg.devDependencies?.[pluginName] ||
    pkg.optionalDependencies?.[pluginName]
}

/**
 * 宿主是否从 npm registry 安装该插件。
 * 只认明确的 npm 语义：仅版本号 / 版本范围 / dist-tag / npm: 别名。
 * 未声明（如 Karin 用 pnpm 从 tarball 安装、插件自行安装）一律视为非 npm 来源。
 */
export const isNpmRegistrySpec = (spec: string | undefined) => {
  if (typeof spec !== 'string') return false
  const value = spec.trim()
  if (value.length === 0) return false
  if (value.startsWith('npm:')) return value.length > 'npm:'.length
  if (/^(file:|link:|workspace:|portal:|git\+|git:|github:|gitlab:|bitbucket:|ssh:|https?:|\.{1,2}[\\/]|~[\\/]|[\\/])/i.test(value)) return false
  if (/^[^@\s][^\s]*[\\/]/.test(value) && !value.startsWith('@')) return false
  return true
}
