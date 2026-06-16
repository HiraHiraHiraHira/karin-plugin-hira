import { musicSourceOptions } from '../options'
import type { ConfigPageProps } from './pageTypes'

const MusicConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderPageHeader, renderSelectField, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('点歌', '点歌来源、多选列表、语音点歌、Cookie 和第三方音乐 API。')}
      {renderSubSection('点歌体验', (
        <>
          {renderSwitch(['music', 'enabled'], '启用点歌', '开启后响应点歌、歌词、语音和 B站音乐链接命令。')}
          {renderSelectField(['music', 'defaultSource'], '默认音乐源', '未指定平台时优先使用的搜索来源。', musicSourceOptions)}
          {renderSwitch(['music', 'listModeDefault'], '默认列表模式', '开启后普通点歌也先返回多选列表。')}
          {renderSwitch(['music', 'highQuality'], '高品质点歌', '支持的平台会尽量返回更高音质音频。')}
          {renderSwitch(['music', 'voiceEnabled'], '启用语音点歌', '开启后可使用语音点歌相关命令。')}
          {renderSwitch(['music', 'textFallback'], '音频失败回退文本', '发送音频失败时回退到文本链接。')}
          {renderTextField(['music', 'pageSize'], '每页数量', '多选点歌列表每页展示的歌曲数量。', { type: 'number', fallback: 10, min: 1, max: 20 })}
          {renderTextField(['music', 'sessionTtlSeconds'], '会话有效期（秒）', '多选列表保留多久可继续用序号选择。', { type: 'number', fallback: 180, min: 30, max: 3600 })}
        </>
      ))}
      {renderSubSection('音乐 Cookie（可选）', (
        <>
          {renderTextField(['music', 'cookies', 'netease'], '网易云 Cookie', '留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['music', 'cookies', 'qq'], 'QQ音乐 Cookie', '留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['music', 'cookies', 'kuwo'], '酷我 Cookie', '留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['music', 'cookies', 'kugou'], '酷狗 Cookie', '留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['music', 'cookies', 'bilibili'], 'B站 Cookie', '用于 B站音乐链接解析，留空不会阻止保存。', { type: 'password' })}
        </>
      ))}
      {renderSubSection('音乐 API', (
        <>
          {renderTextField(['music', 'api', 'neteaseBaseUrl'], '网易云基础 API', '网易云搜索接口基础地址。')}
          {renderTextField(['music', 'api', 'qqTempApi'], 'QQ 临时 API', '需要包含 {keyword} 和 {index} 占位符。')}
        </>
      ))}
    </>
  )
}

export default MusicConfigPage
