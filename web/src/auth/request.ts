import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

import type { ApiResponse } from '../types/api'
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  getUserId,
  setAccessToken,
  setAuthTokens
} from './token'

interface LoginTokens {
  userId: string
  accessToken: string
  refreshToken: string
}

let refreshPromise: Promise<boolean> | null = null

const sha256 = async (message: string) => {
  const buffer = new TextEncoder().encode(message)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const refreshAccessToken = async () => {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const accessToken = getAccessToken()
    const refreshToken = getRefreshToken()
    if (!accessToken || !refreshToken) return false

    try {
      const response = await axios.post<ApiResponse<{ accessToken: string }>>('/api/v1/refresh', {
        accessToken,
        refreshToken
      })
      const nextToken = response.data.data?.accessToken
      if (!nextToken) return false

      setAccessToken(nextToken)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export const authClient = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

authClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  const userId = getUserId()

  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  if (userId) config.headers.set('x-user-id', userId)

  return config
})

authClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResponse<null>>) => {
    const config = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status

    if (config && !config._retry && (status === 401 || status === 419)) {
      config._retry = true
      const refreshed = await refreshAccessToken()
      if (refreshed) return authClient(config)
    }

    if (status === 401 || status === 419 || status === 420) {
      clearAuthTokens()
    }

    throw new Error(error.response?.data?.message || error.message)
  }
)

export const loginWithAuthKey = async (authKey: string) => {
  const authorization = await sha256(authKey)
  const response = await axios.post<ApiResponse<LoginTokens>>('/api/v1/login', { authorization }, {
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.data.data?.accessToken || !response.data.data.userId || !response.data.data.refreshToken) {
    throw new Error(response.data.message || '登录失败')
  }

  setAuthTokens(response.data.data)
}
