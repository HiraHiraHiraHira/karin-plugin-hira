import type { ConfigPageProps } from './pageTypes'

const bytesToMiB = (value: unknown) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return 0
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

const miBToBytes = (value: string) => {
  const mib = Number(value)
  return Number.isFinite(mib) ? Math.round(mib * 1024 * 1024) : 0
}

const RuntimeConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers
  const sizeOptions = (fallback: number, max: number) => ({
    type: 'number' as const,
    fallback,
    min: 0.1,
    max,
    step: 0.1,
    format: bytesToMiB,
    parse: miBToBytes
  })

  return (
    <>
      {renderPageHeader('运行时', '临时文件、缓存清理、下载超时和本地媒体工具路径。')}
      {renderSubSection('文件与清理', (
        <>
          {renderTextField(['runtime', 'tempRoot'], '临时目录', '可选，留空时使用 Karin 共享 temp 目录下的插件子目录（协议端能读到，视频/语音才发得出去）。')}
          {renderSwitch(['runtime', 'cleanupEnabled'], '自动清理临时文件', '开启后由每小时一次的定时任务清理过期下载缓存；容量超限时仍会优先清理最旧文件。')}
          {renderTextField(['runtime', 'cleanupMaxAgeMinutes'], '保留分钟数', '临时文件保留多久后可被清理。', { type: 'number', fallback: 120, min: 1, max: 10080 })}
          {renderTextField(['runtime', 'downloadTimeoutSeconds'], '下载超时（秒）', '解析视频、图片等外部资源下载时的超时时间。', { type: 'number', fallback: 60, min: 5, max: 600 })}
          {renderTextField(['runtime', 'maxVideoFileSizeBytes'], '单个视频上限（MiB）', '单个视频下载的最大体积；默认 200 MiB，超出会中止并清理半成品。', sizeOptions(200, 2048))}
          {renderTextField(['runtime', 'maxAudioFileSizeBytes'], '单个音频上限（MiB）', '语音点歌等音频下载的最大体积；默认 100 MiB，超出会中止并清理半成品。', sizeOptions(100, 1024))}
          {renderTextField(['runtime', 'maxPreviewCoverBytes'], '封面内联上限（MiB）', '预览封面超过此体积时保留远程地址，不转成内联 Base64；默认 10 MiB。', sizeOptions(10, 50))}
          {renderTextField(['runtime', 'maxTempBytes'], '临时目录上限（MiB）', '临时目录超过上限后按最旧文件优先清理；默认 2048 MiB（2 GiB）。', sizeOptions(2048, 20480))}
        </>
      ))}
      {renderSubSection('媒体工具', (
        <>
          {renderTextField(['runtime', 'ffmpegPath'], 'ffmpeg 路径', '用于合并 B站 DASH 视频和音频。')}
        </>
      ))}
    </>
  )
}

export default RuntimeConfigPage
