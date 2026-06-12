export const formatArtists = (artists: string[]) => {
  const clean = artists.map(artist => artist.trim()).filter(Boolean)
  return clean.length > 0 ? clean.join(' / ') : '未知歌手'
}

export const normalizeDuration = (value: number | string | undefined) => {
  if (value === undefined) return undefined

  if (typeof value === 'number') {
    return value > 10000 ? Math.round(value / 1000) : Math.round(value)
  }

  const parts = value.split(':').map(part => Number(part))
  if (parts.some(part => Number.isNaN(part))) return undefined

  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]

  return undefined
}

export const requirePlayableUrl = (url: string | undefined) => {
  if (!url?.trim()) throw new Error('empty playable URL')
  return url
}
