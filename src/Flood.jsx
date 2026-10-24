
import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
const PERIODS = [10, 20, 50, 75, 100, 200, 500]
const number = v => Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : '—'

export function useFlood() {
  const [period, setPeriod] = useState(100)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ data: null, loading: true, error: '' })

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)
    setState({ data: null, loading: true, error: '' })

    async function load() {
      try {
        const response = await fetch(`${API}/api/flood/${period}?refresh=${attempt > 0}`, {
          signal: controller.signal,
          cache: 'no-store'
        })
        if (!response.ok) throw new Error(`Flood API returned HTTP ${response.status}.`)
        const data = await response.json()

        if (data.return_period_years !== period || data.unit !== 'ha' || !['ready', 'no_data'].includes(data.status)) {
          throw new Error('Unexpected Flood API response.')
        }

        if (data.status === 'ready') {
          if (
            !Number.isFinite(data.mapped_inundation_ha) ||
            data.mapped_inundation_ha < 0 ||
            !Number.isFinite(data.excluded_flagged_nonpermanent_ha) ||
            data.excluded_flagged_nonpermanent_ha < 0
          ) throw new Error('Invalid flood area.')

          const url = new URL(data.tileUrl)
          if (url.protocol !== 'https:' || url.hostname !== 'earthengine.googleapis.com') {
            throw new Error('Invalid flood tile URL.')
          }
        } else {
          data.mapped_inundation_ha = null
          data.tileUrl = null
        }

        if (active) setState({ data, loading: false, error: '' })
      } catch (error) {
        if (active) setState({
          data: null,
          loading: false,
          error: error.name === 'AbortError'
            ? 'Flood calculation timed out. Retry below.'
            : `${error.message} Check the Python backend on port 8000.`
        })
      } finally {
        clearTimeout(timeout)
      }
    }

    load()
    const renewal = setInterval(() => setAttempt(v => v + 1), 18 * 60 * 1000)

    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
      clearInterval(renewal)
    }
  }, [period, attempt])

  const current = state.data?.return_period_years === period ? state.data : null
  return {
    ...state,
    data: current,
    period,
    setPeriod,
    retry: () => setAttempt(v => v + 1)
  }
}

export function downloadFlood(data) {
  if (data?.status !== 'ready') return

  const fields = [
    'region', 'metric', 'unit', 'return_period_years',
    'annual_exceedance_probability_percent',
    'mapped_inundation_ha', 'excluded_flagged_nonpermanent_ha',
    'dataset', 'boundary', 'method', 'note', 'computed_at'
  ]
  const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`
  const csv = fields.join(',') + '\r\n' + fields.map(k => quote(data[k])).join(',')
  const url = URL.createObjectURL(new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  }))
  const a = document.createElement('a')
  a.href = url
  a.download = `gombe-river-flood-RP${data.return_period_years}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FloodKPI({ flood, active, onSelect }) {
  return <button
    className={`kpi ${active ? 'selected' : ''}`}
    style={{ '--accent': '#259bff' }}
    onClick={onSelect}
    aria-pressed={active}
  >
    <span className="kpi-top">River flood inundation</span>
    <span className="kpi-value">
      {number(flood.data?.mapped_inundation_ha)}<small>ha</small>
    </span>
    <span className="kpi-caption">
      {flood.loading ? 'Loading flood scenario…'
        : flood.error ? 'Unavailable · open Floods'
        : `RP${flood.period} · Modelled hazard`}
    </span>
  </button>
}

export function FloodControls({ flood }) {
  const d = flood.data

  return <section aria-label="Flood scenario controls" style={{
    padding: 16,
    borderTop: '1px solid #26384b',
    overflowWrap: 'anywhere'
  }}>
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>River flood hazard</strong>

      <label className="basemap-picker">
        Scenario
        <select
          aria-label="Flood return period"
          value={flood.period}
          onChange={e => flood.setPeriod(Number(e.target.value))}
        >
          {PERIODS.map(p => <option key={p} value={p}>
            {p}-year · {number(100 / p)}% annual chance
          </option>)}
        </select>
      </label>

      <button className="secondary-button" onClick={flood.retry} disabled={flood.loading}>
        Retry flood data
      </button>

      <button
        className="secondary-button"
        onClick={() => downloadFlood(d)}
        disabled={d?.status !== 'ready'}
      >
        Download flood CSV
      </button>
    </div>

    <p role="status">
      {flood.loading ? `Calculating RP${flood.period}…`
        : flood.error || (d?.status === 'no_data'
          ? 'No retained flood pixels. This does not confirm zero hazard.'
          : `${number(d?.mapped_inundation_ha)} ha mapped inundation · RP${flood.period}`)}
    </p>

    {d?.status === 'ready' && <p>
      Excluded flagged area: {number(d.excluded_flagged_nonpermanent_ha)} ha
      {' · '}Permanent water also excluded · Approximately 90 m
    </p>}

    <small>
      JRC / CEMS v2.1. A {flood.period}-year scenario means {number(100 / flood.period)}%
      {' '}annual exceedance probability. It is not a calendar year or an observed flood.
      This modelled river hazard layer is not a live warning or complete risk assessment.
      Blank areas are not proof of safety.
    </small>
  </section>
}

export function useFloodMap(instance, ready, enabled, flood) {
  const [status, setStatus] = useState('')
  const data = flood?.data

  useEffect(() => {
    const map = instance.current
    if (!map || !ready || !enabled || data?.status !== 'ready') return

    const source = 'gee-flood', layer = 'gee-flood-depth'
    const remove = () => {
      if (map.getLayer(layer)) map.removeLayer(layer)
      if (map.getSource(source)) map.removeSource(source)
    }
    const onError = e => {
      if (e.sourceId === source) {
        remove()
        setStatus('Flood tiles unavailable. Use Retry flood data below.')
      }
    }
    const onData = e => {
      if (e.sourceId === source && e.isSourceLoaded) setStatus('Flood layer loaded')
    }

    map.on('error', onError)
    map.on('sourcedata', onData)

    try {
      remove()
      setStatus('Loading flood tiles…')
      map.addSource(source, {
        type: 'raster',
        tiles: [data.tileUrl],
        tileSize: 256,
        attribution: 'European Commission JRC / CEMS; FAO GAUL 2025'
      })
      map.addLayer({
        id: layer,
        type: 'raster',
        source,
        paint: {
          'raster-opacity': 1,
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0
        }
      })
    } catch {
      remove()
      setStatus('Flood layer could not be added. Retry flood data below.')
    }

    return () => {
      map.off('error', onError)
      map.off('sourcedata', onData)
      remove()
    }
  }, [instance, ready, enabled, data])

  useEffect(() => {
    if (ready && enabled) instance.current?.flyTo({
      center: [11.21, 10.7],
      zoom: 7.3,
      duration: 700
    })
  }, [instance, ready, enabled])

  return status
}

export function FloodLegend({ flood, status }) {
  if (flood.data?.status !== 'ready') return null

  return <div className="map-legend-strip">
    <strong>MODELLED RIVER DEPTH · RP{flood.period}</strong>
    <span>0</span>
    <div style={{
      width: 140,
      height: 10,
      background: 'linear-gradient(to right,#deebf7,#9ecae1,#4292c6,#08519c,#08306b)'
    }} />
    <span>5+ m</span>
    <small>{status} · Not a live flood</small>
  </div>
}
