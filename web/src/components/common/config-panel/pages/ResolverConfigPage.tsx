import {
  bilibiliCodecOptions,
  bilibiliQualityOptions,
  douyinQualityOptions,
  minutesToSeconds,
  secondsToMinutes
} from '../options'
import type { ConfigPageProps } from './pageTypes'

const minuteOptions = {
  type: 'number' as const,
  fallback: 8,
  min: 0,
  max: 360,
  step: 0.5,
  format: secondsToMinutes,
  parse: minutesToSeconds
}

const ResolverConfigPage = ({ renderers }: ConfigPageProps) => {
  const { renderListField, renderPageHeader, renderSelectField, renderSubSection, renderSwitch, renderTextField } = renderers

  return (
    <>
      {renderPageHeader('多平台解析', 'B站、抖音、微博、小黑盒、小红书、快手、贴吧和通用解析接口。')}
      {renderSubSection('解析总控', (
        <>
          {renderSwitch(['resolver', 'enabled'], '启用多平台解析', '开启后自动识别支持的平台分享链接。')}
          {renderSwitch(['resolver', 'kkkCompat'], 'KKK 兼容模式', '开启时跳过 KKK 已覆盖的平台，关闭后由 Hira 接管更多平台。')}
          {renderSwitch(['resolver', 'commentsEnabled'], '发送评论/回复', '开启后微博、贴吧、小黑盒等富解析会额外发送评论或回复转发。')}
          {renderTextField(['resolver', 'priority'], '解析优先级', '修改后需重启 Karin 才能完全生效。', { type: 'number', fallback: 900, min: 0, max: 9999 })}
          {renderTextField(['resolver', 'maxVideoDurationSeconds'], '通用视频上限（分钟）', '平台未单独配置时使用；配置文件中保存为秒，0 表示不限制。', minuteOptions)}
          {renderTextField(['resolver', 'proxy'], '代理地址', '可选，留空表示不使用代理。')}
        </>
      ))}
      {renderSubSection('B站视频', (
        <>
          {renderTextField(['resolver', 'bilibili', 'maxVideoDurationSeconds'], '下载上限（分钟）', '超过上限仅返回视频信息；0 表示不限制。', minuteOptions)}
          {renderSelectField(['resolver', 'bilibili', 'quality'], '下载画质', '控制 B站视频下载的最高画质。', bilibiliQualityOptions, Number)}
          {renderSelectField(['resolver', 'bilibili', 'codec'], '视频编码', '自动模式优先选择更省体积的现代编码。', bilibiliCodecOptions)}
        </>
      ))}
      {renderSubSection('抖音视频', (
        <>
          {renderTextField(['resolver', 'douyin', 'maxVideoDurationSeconds'], '下载上限（分钟）', '超过上限仅返回作品信息；0 表示不限制。', minuteOptions)}
          {renderSelectField(['resolver', 'douyin', 'quality'], '视频清晰度', '控制抖音视频直链解析时请求的清晰度。', douyinQualityOptions)}
        </>
      ))}
      {renderSubSection('平台 Cookie（可选）', (
        <>
          {renderTextField(['resolver', 'cookies', 'weibo'], '微博 Cookie', '用于提升微博解析成功率，留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['resolver', 'cookies', 'xiaoheihe'], '小黑盒 Cookie', '小黑盒部分帖子需要登录态，留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['resolver', 'cookies', 'douyin'], '抖音 Cookie', '用于抖音原生解析，留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['resolver', 'cookies', 'xiaohongshu'], '小红书 Cookie', '小红书原生解析通常需要登录态，留空不会阻止保存。', { type: 'password' })}
          {renderTextField(['resolver', 'cookies', 'bilibili'], 'B站解析 Cookie', '用于 B站视频信息和高画质流获取，留空不会阻止保存。', { type: 'password' })}
        </>
      ))}
      {renderSubSection('通用解析 API', (
        <>{renderListField(['resolver', 'generalApis'], '兜底解析接口', 'Hira 会按顺序尝试这些接口，每行一个地址，使用 {url} 作为分享链接占位符。')}</>
      ))}
    </>
  )
}

export default ResolverConfigPage
