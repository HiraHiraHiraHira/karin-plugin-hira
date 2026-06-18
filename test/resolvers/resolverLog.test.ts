import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultConfig } from '@/config/defaults'
import { buildResolverStageLog, logResolverStage } from '@/resolvers/resolverLog'

describe('resolver stage logging', () => {
  afterEach(() => {
    defaultConfig.resolver.diagnostics.stageLogsEnabled = true
    defaultConfig.resolver.diagnostics.verboseLogsEnabled = true
  })

  it('formats stage logs without leaking cookies or full sensitive values', () => {
    const line = buildResolverStageLog({
      platform: 'xiaohongshu',
      stage: 'api',
      ok: false,
      reason: '401 unauthorized',
      url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=secret',
      cookie: 'a=b; web_session=secret',
      extra: {
        source: 'web-html',
        authorization: 'Bearer secret-token',
        urlHost: 'sns-img-qc.xhscdn.com'
      }
    })

    expect(line).toContain('[resolver:xiaohongshu]')
    expect(line).toContain('stage=api')
    expect(line).toContain('ok=false')
    expect(line).toContain('reason=401 unauthorized')
    expect(line).toContain('urlHost=www.xiaohongshu.com')
    expect(line).toContain('cookie=present')
    expect(line).toContain('source=web-html')
    expect(line).toContain('extra.urlHost=sns-img-qc.xhscdn.com')
    expect(line).not.toContain('web_session')
    expect(line).not.toContain('secret-token')
    expect(line).not.toContain('xsec_token=secret')
  })

  it('routes successful stages to debug and failures to warn by default', () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn()
    }

    logResolverStage({
      platform: 'weibo',
      stage: 'fallback',
      ok: true,
      extra: { source: 'mobile-html' }
    }, logger)
    logResolverStage({
      platform: 'tieba',
      stage: 'media',
      ok: false,
      reason: '403',
      url: 'https://tiebapic.baidu.com/forum/a.jpg'
    }, logger)

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('[resolver:weibo] stage=fallback ok=true'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[resolver:tieba] stage=media ok=false reason=403 urlHost=tiebapic.baidu.com'))
  })

  it('can suppress verbose successful stage logs while preserving failure warnings', () => {
    defaultConfig.resolver.diagnostics.verboseLogsEnabled = false
    const logger = {
      debug: vi.fn(),
      warn: vi.fn()
    }

    logResolverStage({
      platform: 'weibo',
      stage: 'fallback',
      ok: true
    }, logger)
    logResolverStage({
      platform: 'weibo',
      stage: 'api',
      ok: false,
      reason: '403'
    }, logger)

    expect(logger.debug).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[resolver:weibo] stage=api ok=false reason=403'))
  })
})
