import fs from 'node:fs/promises'

import { encode, getWavFileInfo, isSilk, isWav } from 'silk-wasm'

/**
 * 把下载好的音频转成 QQ 语音端原生的 SILK.
 * 已是 SILK 的文件直接落盘, 避免重复编码; 其它非 WAV 输入无法编码, 交给调用方降级.
 * @returns 写出的 SILK 文件路径
 */
export const encodeSilkFile = async (inputPath: string, outputPath: string) => {
  const input = await fs.readFile(inputPath)

  if (isSilk(input)) {
    await fs.writeFile(outputPath, input)
    return outputPath
  }
  if (!isWav(input)) throw new Error('silk 编码需要 WAV 输入')

  const { sampleRate } = getWavFileInfo(input).fmt
  const result = await encode(input, sampleRate)
  await fs.writeFile(outputPath, result.data)
  return outputPath
}
