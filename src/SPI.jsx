import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
export const spiNumber = value => Number.isFinite(value) ? value.toFixed(3) : '—'

export function useSPI() {
  const [period, setPeriod] = useState('2025-08')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const [year, month] = period.split('-').map(Number)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timeout
    setState({ data: null, error: '', loading: true })

    const delay = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 300000)
      try {
        const response = await fetch(`${API}/api/spi/${year}/${month}?refresh=${attempt > 0}`, {
          signal: controller.signal, cache: 'no-store'
        })
        if (!response.ok) throw new Error(`SPI API returned HTTP ${response.status}.`)
        const data = await response.json()

        if (
          data.year !== year || data.month !== month ||
          !['ready', 'no_data'].includes(data.status) ||
          data.unit !== 'dimensionless'
        ) throw new Error('Unexpected SPI API response.')

        if (data.status === 'ready') {
          const url = new URL(data.tileUrl)
          if (
            !Number.isFinite(data.mean_spi) ||
            !Number.isFinite(data.valid_area_percent) ||
            !Number.isFinite(data.dry_area_percent_of_valid) ||
            url.protocol !== 'https:' ||
            url.hostname !== 'earthengine.googleapis.com'
          ) throw new Error('Invalid SPI data.')
        } else {
          data.mean_spi = null
          data.tileUrl = null
        }

        if (active) setState({ data, error: '', loading: false })
      } catch (error) {
        if (active) setState({
          data: null,
          loading: false,
          error: error.name === 'AbortError'
            ? 'SPI calculation timed out. Retry below.'
            : `${error.message} Check that the Python backend is running on port 8000.`
        })
      } finally {
        clearTimeout(timeout)
      }
    }, 350)

    const renewal = setInterval(() => setAttempt(value => value + 1), 25 * 60 * 1000)
    return () => {
      active = false
      controller.abort()
      clearTimeout(delay)
      clearTimeout(timeout)
      clearInterval(renewal)
    }
  }, [year, month, attempt])

  const current = state.data?.period === period ? state.data : null
  return {
    ...state, data: current, period, setPeriod,
    retry: () => setAttempt(value => value + 1)
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function SPIControls({ spi }) {
  const [year, month] = spi.period.split('-')
  const change = (y, m) => spi.setPeriod(`${y}-${String(m).padStart(2, '0')}`)
  const end = new Date(Number(year), Number(month) - 1, 1)
  const start = new Date(Number(year), Number(month) - 3, 1)
  const label = date => `${MONTHS[date.getMonth()]} ${date.getFullYear()}`

  return <section style={{ padding: 16, borderTop: '1px solid #26384b' }} aria-label="SPI period controls">
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>SPI-3 · Three-month rainfall</strong>
      <label className="basemap-picker">Ending year
        <select aria-label="SPI year" value={year} onChange={e => change(e.target.value, month)}>
          {Array.from({ length: 11 }, (_, i) => 2015 + i).map(y => <option key={y}>{y}</option>)}
        </select>
      </label>
      <label className="basemap-picker">Ending month
        <select aria-label="SPI month" value={Number(month)} onChange={e => change(year, e.target.value)}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </label>
      <button className="secondary-button" disabled={spi.loading} onClick={spi.retry}>Retry SPI data</button>
    </div>

    <label style={{ display: 'block', margin: '12px 0' }}>
      Ending month: {MONTHS[Number(month) - 1]}
      <input style={{ width: '100%' }} aria-label="SPI month slider"
        type="range" min="1" max="12" step="1" value={Number(month)}
        onChange={e => change(year, e.target.value)} />
    </label>

    <p>{label(start)}–{label(end)} · Reference: 1991–2020 · CHIRPS v2 Final</p>
    <p role="status">
      {spi.loading ? `Calculating SPI-3 for ${spi.period}…` : spi.error ||
        (spi.data?.status === 'no_data'
          ? 'No valid SPI estimates. Insufficient data or invalid statistical fits.'
          : `Mean pixel SPI-3: ${spiNumber(spi.data?.mean_spi)}`)}
    </p>

    {spi.data?.status === 'ready' &&
      <p>Dry area (SPI ≤ −1): {spi.data.dry_area_percent_of_valid.toFixed(2)}% of valid area · Valid coverage: {spi.data.valid_area_percent.toFixed(2)}%</p>}

    <small>Approximately 5.6 km pixels. Mean SPI is an area-weighted mean of pixel SPI, not SPI fitted to statewide rainfall. Blank pixels are unavailable, not near normal. This measures rainfall conditions, not crop losses or forecasts.</small>
  </section>
}

export function useSPIMap(instance, ready, enabled, spi) {
  const [status, setStatus] = useState('')
  const data = spi?.data

  useEffect(() => {
    const map = instance.current
    if (!map || !ready || !enabled || data?.status !== 'ready') return

    const source = 'gee-spi', layer = 'gee-spi-temperature'
    let active = true
    const remove = () => {
      if (map.getLayer(layer)) map.removeLayer(layer)
      if (map.getSource(source)) map.removeSource(source)
    }
    const onError = event => {
      if (active && event.sourceId === source) {
        remove()
        setStatus('SPI tiles unavailable. Use Retry SPI data below.')
      }
    }
    const onData = event => {
      if (active && event.sourceId === source && event.isSourceLoaded)
        setStatus('SPI layer loaded')
    }

    map.on('error', onError)
    map.on('sourcedata', onData)

    try {
      remove()
      setStatus('Loading SPI tiles…')
      map.addSource(source, {
        type: 'raster', tiles: [data.tileUrl], tileSize: 256,
        attribution: 'CHIRPS v2 Final / UCSB CHG; boundary: FAO GAUL 2025'
      })
      map.addLayer({
        id: layer, type: 'raster', source,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          'raster-resampling': 'nearest'
        }
      })
    } catch {
      remove()
      setStatus('SPI layer could not be added. Retry SPI data below.')
    }

    return () => {
      active = false
      map.off('error', onError)
      map.off('sourcedata', onData)
      remove()
    }
  }, [instance, ready, enabled, data])

  useEffect(() => {
    if (ready && enabled)
      instance.current?.flyTo({ center: [11.21, 10.7], zoom: 7.3, duration: 700 })
  }, [instance, ready, enabled])

  return status
}

export function SPILegend({ spi, status }) {
  if (spi?.data?.status !== 'ready') return null
  const colours = ['8b0000', 'e34a33', 'fdbb84', 'f0f0f0', 'a6bddb', '3690c0', '034e7b']
  const labels = [
    'Extremely dry ≤ −2',
    'Severely dry > −2 to −1.5',
    'Moderately dry > −1.5 to −1',
    'Near normal > −1 to < 1',
    'Moderately wet 1 to < 1.5',
    'Very wet 1.5 to < 2',
    'Extremely wet ≥ 2'
  ]
  return <div className="map-legend-strip" style={{ flexWrap: 'wrap' }}>
    <strong>SPI-3 · {spi.period}</strong>
    {labels.map((label, i) =>
      <span key={label} style={{ fontSize: 11 }}>
        <span style={{ color: '#' + colours[i] }}>■</span> {label}
      </span>
    )}
    <small>{status}</small>
  </div>
}
