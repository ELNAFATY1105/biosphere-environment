
import { useEffect, useRef, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
const SOURCE = 'gee-forest'
const LAYER = 'gee-forest-loss'

export default function useForestLayer(instance, ready, module, year) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('')
  const recovery = useRef(0)
  const viewed = useRef(false)

  useEffect(() => {
    const map = instance.current
    if (!ready || !map || module !== 'forest') return

    const controller = new AbortController()
    let active = true
    let failed = false
    let timeout
    let renewal

    const remove = () => {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER)
      if (map.getSource(SOURCE)) map.removeSource(SOURCE)
    }

    remove()
    setStatus(`Preparing ${year} loss layer…`)

    if (!viewed.current) {
      viewed.current = true
      map.flyTo({
        center: [11.21, 10.29],
        zoom: 7.5,
        duration: 700
      })
    }

    const onError = (event) => {
      if (!active || event.sourceId !== SOURCE || failed) return
      failed = true
      remove()

      if (Date.now() - recovery.current > 60000) {
        recovery.current = Date.now()
        setAttempt(value => value + 1)
      } else {
        setStatus('Forest tiles could not load. Check your connection, then retry.')
      }
    }

    const onData = (event) => {
      if (
        active && !failed &&
        event.sourceId === SOURCE &&
        event.isSourceLoaded
      ) {
        setStatus(`Annual loss layer loaded · ${year}`)
      }
    }

    map.on('error', onError)
    map.on('sourcedata', onData)

    const delay = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 35000)

      try {
        const response = await fetch(
          `${API}/api/forest/${year}?refresh=${attempt > 0}`,
          { signal: controller.signal, cache: 'no-store' }
        )

        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}.`)
        }

        const data = await response.json()
        const url = new URL(data.tileUrl)

        if (
          data.year !== year ||
          url.protocol !== 'https:' ||
          url.hostname !== 'earthengine.googleapis.com'
        ) {
          throw new Error('Unexpected forest layer response.')
        }

        if (!active) return

        map.addSource(SOURCE, {
          type: 'raster',
          tiles: [data.tileUrl],
          tileSize: 256,
          attribution: 'Hansen/UMD/Google/USGS/NASA; boundary: FAO GAUL 2025'
        })

        map.addLayer({
          id: LAYER,
          type: 'raster',
          source: SOURCE,
          paint: {
            'raster-opacity': 0.9,
            'raster-fade-duration': 0,
            'raster-resampling': 'nearest'
          }
        })

        setStatus(`Loading ${year} tiles…`)
        renewal = setTimeout(
          () => setAttempt(value => value + 1),
          25 * 60 * 1000
        )
      } catch (error) {
        if (!active) return
        remove()

        setStatus(
          error.name === 'AbortError'
            ? 'Forest request timed out. Retry when the connection is ready.'
            : `Forest layer unavailable. Keep the Python backend running on port 8000. ${error instanceof TypeError ? 'Check its address and CORS settings.' : error.message}`
        )
      } finally {
        clearTimeout(timeout)
      }
    }, 350)

    return () => {
      active = false
      clearTimeout(delay)
      clearTimeout(timeout)
      clearTimeout(renewal)
      controller.abort()
      map.off('error', onError)
      map.off('sourcedata', onData)
      remove()
    }
  }, [instance, ready, module, year, attempt])

  return {
    status,
    retry: () => setAttempt(value => value + 1)
  }
}
