
import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
export const carbonNumber = (v, digits = 3) => Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—'

export function useCarbon() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ data: null, loading: true, error: '' })

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)
    setState({ data: null, loading: true, error: '' })

    async function load() {
      try {
        const response = await fetch(`${API}/api/carbon/2010?refresh=${attempt > 0}`, {
          signal: controller.signal,
          cache: 'no-store'
        })
        if (!response.ok) throw new Error(`Carbon API returned HTTP ${response.status}.`)
        const data = await response.json()

        if (data.year !== 2010 || data.unit !== 't C' || !['ready', 'no_data'].includes(data.status)) {
          throw new Error('Unexpected Carbon API response.')
        }

        if (data.status === 'ready') {
          const fields = [
            'aboveground_tC', 'belowground_tC', 'total_tC',
            'total_MtC', 'mean_density_tC_ha', 'valid_area_percent'
          ]
          if (fields.some(key => !Number.isFinite(data[key]) || data[key] < 0) || data.valid_area_percent > 100.001) {
            throw new Error('Invalid carbon totals.')
          }
          const url = new URL(data.tileUrl)
          if (url.protocol !== 'https:' || url.hostname !== 'earthengine.googleapis.com') {
            throw new Error('Invalid carbon tile URL.')
          }
        } else {
          data.tileUrl = null
          for (const key of ['aboveground_tC', 'belowground_tC', 'total_tC', 'total_MtC', 'mean_density_tC_ha']) {
            data[key] = null
          }
        }

        if (active) setState({ data, loading: false, error: '' })
      } catch (error) {
        if (active) setState({
          data: null,
          loading: false,
          error: error.name === 'AbortError'
            ? 'Carbon request timed out. Retry below.'
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
  }, [attempt])

  return { ...state, retry: () => setAttempt(v => v + 1) }
}

export function downloadCarbon(data) {
  if (data?.status !== 'ready') return
  const fields = [
    'year', 'region', 'metric', 'unit',
    'aboveground_tC', 'belowground_tC', 'total_tC', 'total_MtC',
    'mean_density_tC_ha', 'valid_area_percent',
    'dataset', 'boundary', 'method', 'note', 'computed_at'
  ]
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = fields.join(',') + '\r\n' + fields.map(key => quote(data[key])).join(',')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'gombe-living-biomass-carbon-2010.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CarbonSummary({ carbon }) {
  const d = carbon.data
  return <section aria-label="Carbon baseline summary" style={{
    padding: 16, borderTop: '1px solid #26384b', overflowWrap: 'anywhere'
  }}>
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>Living-biomass carbon · 2010 baseline</strong>
      <button className="secondary-button" disabled={carbon.loading} onClick={carbon.retry}>
        Retry carbon data
      </button>
      <button className="secondary-button" disabled={d?.status !== 'ready'} onClick={() => downloadCarbon(d)}>
        Download carbon CSV
      </button>
    </div>

    <p role="status">
      {carbon.loading ? 'Calculating carbon stock…' : carbon.error ||
        (d?.status === 'no_data'
          ? 'No valid carbon observations. Missing data is not zero.'
          : `${carbonNumber(d?.total_MtC)} million tonnes C · Gombe State`)}
    </p>

    {d?.status === 'ready' && <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 16,
      margin: '16px 0'
    }}>
      {[
        ['Aboveground', `${carbonNumber(d.aboveground_tC / 1e6)} Mt C`],
        ['Belowground', `${carbonNumber(d.belowground_tC / 1e6)} Mt C`],
        ['Mean density', `${carbonNumber(d.mean_density_tC_ha, 2)} t C/ha`],
        ['Valid area', `${carbonNumber(d.valid_area_percent, 2)}%`]
      ].map(([label, value]) => <div key={label}>
        <small>{label}</small><div><strong>{value}</strong></div>
      </div>)}
    </div>}

    <small>
      NASA/ORNL · Approximately 300 m. Historical living-biomass carbon,
      excluding soil, dead wood and litter. Totals cover valid pixels only.
      This is not current stock, emissions or a sequestration rate.
      A single baseline cannot show an annual trend.
    </small>
  </section>
}

export function useCarbonMap(instance, ready, enabled, carbon) {
  const [status, setStatus] = useState('')
  const data = carbon?.data

  useEffect(() => {
    const map = instance.current
    if (!map || !ready || !enabled || data?.status !== 'ready') return
    const source = 'gee-carbon', layer = 'gee-carbon-density'

    const remove = () => {
      if (map.getLayer(layer)) map.removeLayer(layer)
      if (map.getSource(source)) map.removeSource(source)
    }
    const onError = e => {
      if (e.sourceId === source) {
        remove()
        setStatus('Carbon tiles unavailable. Use Retry carbon data below.')
      }
    }
    const onData = e => {
      if (e.sourceId === source && e.isSourceLoaded) setStatus('Carbon layer loaded')
    }

    map.on('error', onError)
    map.on('sourcedata', onData)

    try {
      remove()
      setStatus('Loading carbon tiles…')
      map.addSource(source, {
        type: 'raster',
        tiles: [data.tileUrl],
        tileSize: 256,
        attribution: 'NASA/ORNL; FAO GAUL 2025'
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
      setStatus('Carbon layer could not be added. Retry carbon data below.')
    }

    return () => {
      map.off('error', onError)
      map.off('sourcedata', onData)
      remove()
    }
  }, [instance, ready, enabled, data])

  useEffect(() => {
    if (ready && enabled) instance.current?.flyTo({
      center: [11.21, 10.7], zoom: 7.3, duration: 700
    })
  }, [instance, ready, enabled])

  return status
}

export function CarbonLegend({ carbon, status }) {
  if (carbon.data?.status !== 'ready') return null
  return <div className="map-legend-strip">
    <strong>LIVING-BIOMASS CARBON · 2010</strong>
    <span>0</span>
    <div style={{
      width: 140, height: 10,
      background: 'linear-gradient(to right,#ffffcc,#c2e699,#78c679,#31a354,#006837)'
    }} />
    <span>50+ t C/ha</span>
    <small>{status} · Missing pixels remain transparent</small>
  </div>
}
