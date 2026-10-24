import { useEffect, useState } from 'react'

export const HEAT_API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
export const heatNumber = value => Number.isFinite(value) ? value.toFixed(1) : '—'

export function validateHeat(data, year, month, lgaCode) {
  if (data.year !== year || data.month !== month || data.period !== `${year}-${String(month).padStart(2, '0')}` || data.lga_code !== (lgaCode || null) || data.unit !== '°C' || !['ready', 'no_data'].includes(data.status)) {
    throw new Error('Heat results do not match the selected area or month. Check that the updated backend is running.')
  }
  if (typeof data.region !== 'string' || !data.region || !data.boundary) throw new Error('Heat area metadata is missing.')
  if (data.status === 'ready') {
    const url = new URL(data.tileUrl)
    if (![data.mean_lst_c, data.valid_area_percent, data.mean_valid_days].every(Number.isFinite) || data.valid_area_percent < 0 || data.valid_area_percent > 100.001 || data.mean_valid_days <= 0 || url.protocol !== 'https:' || url.hostname !== 'earthengine.googleapis.com') throw new Error('Invalid Heat data.')
  } else {
    data.mean_lst_c = null
    data.tileUrl = null
  }
  return data
}

export function useHeat() {
  const [period, setPeriod] = useState('2025-04')
  const [lgaCode, setLgaCode] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalog, setCatalog] = useState({ loading: true, error: '', lgas: [] })
  const [state, setState] = useState({ key: '', data: null, error: '', loading: true })
  const [year, month] = period.split('-').map(Number)
  const key = `${period}:${lgaCode ?? 'state'}`
  const regionName = lgaCode === null ? 'All Gombe State' : `${catalog.lgas.find(area => area.lga_code === lgaCode)?.name || 'Selected'} LGA`

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(() => controller.abort(), 180000)
    setCatalog(previous => ({ ...previous, loading: true, error: '' }))
    async function load() {
      try {
        const response = await fetch(`${HEAT_API}/api/regions`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Area list returned HTTP ${response.status}`)
        const data = await response.json()
        if (data.status !== 'ready' || !Array.isArray(data.lgas) || data.lgas.length === 0 || data.lgas.some(area => !Number.isInteger(area.lga_code) || typeof area.name !== 'string') || new Set(data.lgas.map(area => area.lga_code)).size !== data.lgas.length) throw new Error('Invalid LGA list.')
        if (active) setCatalog({ loading: false, error: '', lgas: data.lgas })
      } catch (error) {
        if (active) setCatalog(previous => ({ ...previous, loading: false, error: error.name === 'AbortError' ? 'LGA list timed out. Retry areas.' : error.message }))
      } finally { clearTimeout(timeout) }
    }
    load()
    return () => { active = false; controller.abort(); clearTimeout(timeout) }
  }, [catalogAttempt])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timeout
    setState({ key, data: null, error: '', loading: true })
    const delay = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 180000)
      try {
        const params = new URLSearchParams({ refresh: String(attempt > 0) })
        if (lgaCode !== null) params.set('lga_code', String(lgaCode))
        const response = await fetch(`${HEAT_API}/api/heat/${year}/${month}?${params}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Heat API returned HTTP ${response.status}.`)
        const data = validateHeat(await response.json(), year, month, lgaCode)
        if (active) setState({ key, data, error: '', loading: false })
      } catch (error) {
        if (active) setState({ key, data: null, loading: false, error: error.name === 'AbortError' ? 'Heat calculation timed out. Retry below.' : `${error.message} Check the Python backend on port 8000.` })
      } finally { clearTimeout(timeout) }
    }, 350)
    const renewal = setInterval(() => setAttempt(value => value + 1), 25 * 60 * 1000)
    return () => { active = false; controller.abort(); clearTimeout(delay); clearTimeout(timeout); clearInterval(renewal) }
  }, [year, month, lgaCode, key, attempt])

  const current = state.key === key ? state : { data: null, error: '', loading: true }
  return {
    ...current, period, setPeriod, lgaCode, regionName, catalog,
    setLgaCode: value => setLgaCode(value === '' || value === null ? null : Number(value)),
    retry: () => setAttempt(value => value + 1),
    retryAreas: () => setCatalogAttempt(value => value + 1),
  }
}

export function HeatControls({ heat }) {
  const [year, month] = heat.period.split('-')
  const change = (y, m) => heat.setPeriod(`${y}-${String(m).padStart(2, '0')}`)
  return <section style={{ padding: 16, borderTop: '1px solid #26384b', overflowWrap: 'anywhere' }} aria-label="Heat period controls">
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>Daytime surface temperature</strong>
      <label className="basemap-picker">Heat area
        <select aria-label="Heat area" value={heat.lgaCode ?? ''} onChange={event => heat.setLgaCode(event.target.value)} style={{ maxWidth: '100%' }}>
          <option value="">All Gombe State</option>
          {heat.catalog.lgas.map(area => <option key={area.lga_code} value={area.lga_code}>{area.name} LGA</option>)}
        </select>
      </label>
      <label className="basemap-picker">Year<select aria-label="Heat year" value={year} onChange={event => change(event.target.value, month)}>{Array.from({ length: 11 }, (_, i) => <option key={i}>{2015 + i}</option>)}</select></label>
      <label className="basemap-picker">Month<select aria-label="Heat month" value={Number(month)} onChange={event => change(year, event.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2025, i, 1).toLocaleString('en', { month: 'long' })}</option>)}</select></label>
      <button className="secondary-button" onClick={heat.retry} disabled={heat.loading}>Retry heat data</button>
    </div>
    {heat.catalog.loading && <p role="status">Loading LGA choices… Statewide Heat remains available.</p>}
    {heat.catalog.error && <p role="status">{heat.catalog.error} <button className="secondary-button" onClick={heat.retryAreas}>Retry areas</button></p>}
    <p role="status">{heat.loading ? `Calculating ${heat.period} · ${heat.regionName}…` : heat.error || (heat.data?.status === 'no_data' ? `No accepted observations · ${heat.regionName} · ${heat.period}` : `${heatNumber(heat.data?.mean_lst_c)} °C · ${heat.period} · ${heat.regionName}`)}</p>
    {heat.data?.status === 'ready' && <p>Valid area: {heat.data.valid_area_percent.toFixed(2)}% · Mean valid days: {heatNumber(heat.data.mean_valid_days)} · Approximately 1 km pixels</p>}
    <small>This area selection applies to Heat only. The other indicators remain statewide. NASA MODIS daytime surface temperature is not air temperature. Cloud gaps remain blank. Open Indicator analysis to load this area's monthly chart and CSV.</small>
  </section>
}

export function useHeatMap(instance, ready, enabled, heat) {
  const [status, setStatus] = useState('')
  const data = heat?.data
  useEffect(() => {
    const map = instance.current
    if (!map || !ready || !enabled || data?.status !== 'ready') return
    const source = 'gee-heat', layer = 'gee-heat-temperature'
    let active = true
    let failed = false
    const remove = () => { if (map.getLayer(layer)) map.removeLayer(layer); if (map.getSource(source)) map.removeSource(source) }
    const onError = event => { if (active && event.sourceId === source) { failed = true; remove(); setStatus('Heat tiles unavailable. Use Retry heat data below.') } }
    const onData = event => { if (active && !failed && event.sourceId === source && event.isSourceLoaded) setStatus('Heat layer loaded') }
    map.on('error', onError); map.on('sourcedata', onData)
    try {
      remove(); setStatus('Loading heat tiles…')
      map.addSource(source, { type: 'raster', tiles: [data.tileUrl], tileSize: 256, attribution: `NASA MOD11A1.061; boundary: ${data.boundary}` })
      map.addLayer({ id: layer, type: 'raster', source, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } })
    } catch { failed = true; remove(); setStatus('Heat layer could not be added. Retry heat data below.') }
    return () => { active = false; map.off('error', onError); map.off('sourcedata', onData); remove() }
  }, [instance, ready, enabled, data])
  useEffect(() => {
    if (ready && enabled) instance.current?.flyTo({ center: [11.21, 10.7], zoom: 7.3, duration: 700 })
  }, [instance, ready, enabled])
  return data?.status === 'ready' ? status : ''
}

export function HeatLegend({ heat, status }) {
  if (heat?.data?.status !== 'ready') return null
  return <div className="map-legend-strip" style={{ flexWrap: 'wrap' }}>
    <strong>DAYTIME LST · {heat.period} · {heat.regionName}</strong>
    <span>20°C</span><div style={{ width: 160, height: 10, borderRadius: 5, background: 'linear-gradient(to right,#2166ac,#67a9cf,#d1e5f0,#ffffbf,#fdae61,#f46d43,#a50026)' }} /><span>60°C</span>
    <small>{status} · Colours are not heat-risk classes</small>
  </div>
}
