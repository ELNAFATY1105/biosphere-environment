
import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')

export const formatHectares = value => value == null ? '—' :
  new Intl.NumberFormat('en-NG', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value)

export function useForestStats() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({
    data: null, error: '', loading: true
  })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ data: null, error: '', loading: true })
    const timeout = setTimeout(() => controller.abort(), 300000)

    async function load() {
      try {
        const response = await fetch(`${API}/api/forest/stats`, {
          signal: controller.signal,
          cache: 'no-store'
        })

        if (!response.ok) {
          throw new Error(`Statistics API returned HTTP ${response.status}.`)
        }

        const data = await response.json()

        if (
          data.status !== 'ready' ||
          data.unit !== 'ha' ||
          !Array.isArray(data.annual) ||
          data.annual.length !== 11
        ) {
          throw new Error('Unexpected statistics response.')
        }

        const annual = [...data.annual].sort((a, b) => a.year - b.year)

        if (annual.some((row, index) =>
          row.year !== 2015 + index ||
          typeof row.loss_ha !== 'number' ||
          !Number.isFinite(row.loss_ha) ||
          row.loss_ha < 0
        )) {
          throw new Error('Annual statistics are incomplete or invalid.')
        }

        const total = annual.reduce((sum, row) => sum + row.loss_ha, 0)

        if (
          !Number.isFinite(data.total_loss_ha) ||
          Math.abs(total - data.total_loss_ha) > 0.01
        ) {
          throw new Error('The annual values and total do not agree.')
        }

        if (active) {
          setState({
            data: { ...data, annual },
            error: '',
            loading: false
          })
        }
      } catch (error) {
        if (active) {
          setState({
            data: null,
            error: error.name === 'AbortError'
              ? 'Statistics request timed out. Retry after checking the backend.'
              : `Could not load forest statistics. ${error.message}`,
            loading: false
          })
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    load()
    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
    }
  }, [attempt])

  return {
    ...state,
    retry: () => setAttempt(value => value + 1)
  }
}

export function ForestStatsChart({ stats, year, onYearChange }) {
  if (stats.loading) {
    return <div className="panel-footnote" role="status">
      Calculating annual loss areas… The first request can take several minutes.
    </div>
  }

  if (stats.error || !stats.data) {
    return <div className="panel-footnote" role="status">
      <p>{stats.error || 'Statistics are unavailable.'}</p>
      <button className="secondary-button" onClick={stats.retry}>
        Retry forest statistics
      </button>
    </div>
  }

  const data = stats.data
  const selected = data.annual.find(row => row.year === year)
  const maximum = Math.max(1, ...data.annual.map(row => row.loss_ha))

  function download() {
    const rows = [
      ['year', 'loss_ha', 'unit', 'dataset', 'boundary', 'method', 'computed_at'],
      ...data.annual.map(row => [
        row.year, row.loss_ha, 'ha', data.dataset,
        data.boundary, data.method, data.computed_at
      ])
    ]

    const csv = rows.map(row =>
      row.map(value =>
        '"' + String(value ?? '').replaceAll('"', '""') + '"'
      ).join(',')
    ).join('\r\n')

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'gombe-annual-tree-cover-loss-2015-2025.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div style={{ padding: '0 18px 18px', minWidth: 0 }}>
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 20,
      alignItems: 'center', marginBottom: 16
    }}>
      <div>
        <small>{year} detected loss</small>
        <div style={{ fontSize: 26, color: '#ff8f86' }}>
          {formatHectares(selected?.loss_ha)} ha
        </div>
      </div>
      <div>
        <small>Total · 2015–2025</small>
        <div style={{ fontSize: 22 }}>
          {formatHectares(data.total_loss_ha)} ha
        </div>
      </div>
      <button className="secondary-button" onClick={download}>
        Download forest CSV
      </button>
    </div>

    <p className="panel-footnote">
      Annual detected tree-cover loss (ha).
      Select a bar to change the map year.
    </p>

    <div
      style={{ overflowX: 'auto' }}
      role="group"
      aria-label="Annual tree-cover loss in hectares, 2015 to 2025"
    >
      <div style={{
        display: 'flex', gap: 8, minWidth: 650,
        height: 205, alignItems: 'stretch', padding: '8px 2px'
      }}>
        {data.annual.map(row => <button
          key={row.year}
          aria-pressed={year === row.year}
          aria-label={`${row.year}: ${formatHectares(row.loss_ha)} hectares of detected tree-cover loss`}
          onClick={() => onYearChange(row.year)}
          style={{
            flex: 1, minWidth: 0, display: 'flex',
            flexDirection: 'column', justifyContent: 'flex-end',
            alignItems: 'center', gap: 7,
            border: year === row.year
              ? '1px solid #a9d8c5'
              : '1px solid transparent',
            borderRadius: 4, background: 'transparent',
            color: '#c4d6e4', padding: 4, fontSize: 10
          }}
        >
          <span>{formatHectares(row.loss_ha)}</span>
          <span aria-hidden="true" style={{
            display: 'block', width: '75%',
            height: 130 * row.loss_ha / maximum,
            flexShrink: 0,
            background: year === row.year ? '#ff8f86' : '#b65a56',
            borderRadius: '3px 3px 0 0'
          }} />
          <span>{row.year}</span>
        </button>)}
      </div>
    </div>

    <p className="panel-footnote">
      Hansen GFC v1.13 · FAO GAUL 2025 boundary · native pixel grid,
      no additional canopy threshold. Gross detected loss; not remaining
      forest cover, net change or confirmed deforestation.
    </p>
  </div>
}
