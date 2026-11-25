import fs from 'node:fs'
import path from 'node:path'

/**
 * 原子写文件：先写同目录临时文件并 fsync，再 rename 替换目标文件。
 * 兼容 Windows 上 renameSync 覆盖已存在文件偶发报 EEXIST / EPERM 的情况。
 */
export const atomicWriteFileSync = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    const descriptor = fs.openSync(temporaryFile, 'w')
    try {
      fs.writeFileSync(descriptor, content, 'utf8')
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }

    try {
      fs.renameSync(temporaryFile, file)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        fs.rmSync(file, { force: true })
        fs.renameSync(temporaryFile, file)
      } else {
        throw error
      }
    }
  } finally {
    fs.rmSync(temporaryFile, { force: true })
  }
}
