import { Config } from '@/config'

import {
  fetchJson,
  fetchResponse,
  fetchText,
  resolveRedirectUrl,
  type FetchJsonOptions
} from './http'

const withResolverProxy = (options: FetchJsonOptions = {}): FetchJsonOptions => ({
  ...options,
  proxy: Config.resolver.proxy.trim() || undefined
})

export const fetchResolverJson = <T = unknown>(url: string, options: FetchJsonOptions = {}) => (
  fetchJson<T>(url, withResolverProxy(options))
)

export const fetchResolverText = (url: string, options: FetchJsonOptions = {}) => (
  fetchText(url, withResolverProxy(options))
)

export const fetchResolverResponse = (url: string, options: FetchJsonOptions = {}) => (
  fetchResponse(url, withResolverProxy(options))
)

export const resolveResolverRedirectUrl = (url: string, options: FetchJsonOptions = {}) => (
  resolveRedirectUrl(url, withResolverProxy(options))
)
