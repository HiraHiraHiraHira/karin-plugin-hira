import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('package entrypoints', () => {
  it('ships the declared type entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      types: string
    }
    const typeEntry = path.join(process.cwd(), pkg.types)

    expect(fs.existsSync(typeEntry)).toBe(true)
  })
})
