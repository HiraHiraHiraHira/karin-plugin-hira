import type { ConfigPageProps } from './pageTypes'

const RuntimeConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('运行时', '临时文件、缓存清理、下载超时和本地媒体工具路径。')}
      {renderSubSection('文件与清理', (
        <>
          {renderTextField(['runtime', 'tempRoot'], '临时目录', '可选，留空时使用插件默认数据目录。')}
          {renderSwitch(['runtime', 'cleanupEnabled'], '自动清理临时文件', '开启后定期删除过期下载缓存。')}
          {renderTextField(['runtime', 'cleanupMaxAgeMinutes'], '保留分钟数', '临时文件保留多久后可被清理。', { type: 'number', fallback: 120, min: 1, max: 10080 })}
          {renderTextField(['runtime', 'downloadTimeoutSeconds'], '下载超时（秒）', '解析视频、图片等外部资源下载时的超时时间。', { type: 'number', fallback: 60, min: 5, max: 600 })}
        </>
      ))}
      {renderSubSection('媒体工具', (
        <>
          {renderTextField(['runtime', 'ffmpegPath'], 'ffmpeg 路径', '用于合并 B站 DASH 视频和音频。')}
          {renderTextField(['runtime', 'ffprobePath'], 'ffprobe 路径', '用于后续媒体信息检测。')}
        </>
      ))}
    </>
  )
}

export default RuntimeConfigPage
