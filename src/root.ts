import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PackageJson = {
  name: string
  version: string
}

const resolvePluginRoot = (startUrl: string) => {
  let dir = path.dirname(startUrl)
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) return dir

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return path.resolve(startUrl, '../..')
}

const pluginPath = resolvePluginRoot(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf-8')) as PackageJson

export const Root = {
  pluginName: pkg.name,
  pluginVersion: pkg.version,
  pluginPath
}
