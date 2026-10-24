import { useEffect, useRef, useState } from 'react'

const API = (import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)).replace(/\/$/, '')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const blankRows = () => MONTHS.map((label, index) => ({
  month: index + 1, label, status: 'pending'
}))
const number = value => Number.isFinite(value) ? value.toFixed(3) : '—'

export default function SPITrend({ spi, onSelect }) {
  const year = Number(spi.period.slice(0, 4))
  const selectedMonth = Number(spi.period.slice(5))
  const [result, setResult] = useState({ year, rows: blankRows() })
  const [busy, setBusy] = useState(false)
  const job = useRef(null)
  const rows = result.year === year ? result.rows : blankRows()

  useEffect(() => {
    job.current?.abort()
    job.current = null
    setBusy(false)
    setResult({ year, rows: blankRows() })
    return () => {
      job.current?.abort()
      job.current = null
    }
  }, [year])

  async function load() {
    job.current?.abort()
    const controller = new AbortController()
    job.current = controller
    setBusy(true)
    const next = blankRows()
    setResult({ year, rows: [...next] })

    for (let month = 1; month <= 12; month++) {
      if (controller.signal.aborted) break
      const request = new AbortController()
      const cancel = () => request.abort()
      controller.signal.addEventListener('abort', cancel, { once: true })
      const timeout = setTimeout(cancel, 300000)

      try {
        const response = await fetch(
          `${API}/api/spi/${year}/${month}`,
          { signal: request.signal, cache: 'no-store' }
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()

        if (
          data.year !== year || data.month !== month ||
          data.unit !== 'dimensionless' ||
          !['ready', 'no_data'].includes(data.status)
        ) throw new Error('Unexpected API response')

        if (
          data.status === 'ready' &&
          ![
            data.mean_spi,
            data.valid_area_percent,
            data.dry_area_percent_of_valid
          ].every(Number.isFinite)
        ) throw new Error('Invalid statistics')

        next[month - 1] = {
          ...next[month - 1],
          ...data,
          mean_spi: data.status === 'ready' ? data.mean_spi : null,
          label: MONTHS[month - 1]
        }
      } catch (error) {
        if (controller.signal.aborted) break
        next[month - 1] = {
          ...next[month - 1],
          status: 'error',
          error: error.name === 'AbortError'
            ? 'Request timed out'
            : error.message
        }
      } finally {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', cancel)
      }

      if (job.current === controller)
        setResult({ year, rows: [...next] })
    }

    if (job.current === controller) {
      job.current = null
      setBusy(false)
    }
  }

  function stop() {
    job.current?.abort()
    job.current = null
    setBusy(false)
  }

  function download() {
    const fields = ['year', 'month', 'period', 'status', 'mean_spi', 'valid_area_percent', 'dry_area_percent_of_valid', 'baseline', 'dataset', 'attribution', 'method', 'quality_rule', 'note', 'computed_at', 'error']
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = [
      fields.join(','),
      ...rows.map(row => fields.map(field =>
        quote(field === 'year' ? year : row[field])
      ).join(','))
    ].join('\r\n')

    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `gombe-monthly-spi3-${year}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const valid = rows.filter(row => row.status === 'ready')
  const completed = rows.filter(row => row.status !== 'pending').length
  const failures = rows.filter(row => row.status === 'error').length

  const low = Math.min(-2, ...valid.map(row => Math.floor(row.mean_spi) - 1))
  const high = Math.max(2, ...valid.map(row => Math.ceil(row.mean_spi) + 1))
  const x = month => 55 + (month - 1) * 59
  const y = value => 205 - (value - low) / (high - low) * 165

  return <section
    style={{ padding: 18, minWidth: 0 }}
    aria-label="Monthly SPI trend"
  >
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>Gombe mean pixel SPI-3 · {year}</strong>
      <button className="secondary-button" disabled={busy} onClick={load}>
        {completed ? 'Reload monthly trend' : 'Load monthly trend'}
      </button>
      {busy &&
        <button className="secondary-button" onClick={stop}>
          Stop loading
        </button>
      }
      <button
        className="secondary-button"
        disabled={busy || completed !== 12}
        onClick={download}
      >
        Download spi CSV
      </button>
    </div>

    <p role="status">
      {busy
        ? `Loading monthly statistics: ${completed}/12 complete…`
        : completed
          ? `${completed}/12 months processed. ${valid.length} with valid SPI estimates; ${failures} failed.`
          : 'Load the selected year to calculate January–December. Change the year using the SPI controls below the map.'}
    </p>

    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox="0 0 760 245"
        style={{ display: 'block', width: '100%', minWidth: 620 }}
        role="img"
        aria-label={`Monthly area-weighted mean pixel SPI-3 for ${year}. Missing months have gaps.`}
      >
        {[0, 1, 2, 3, 4].map(i => {
          const value = low + (high - low) * i / 4
          return <g key={i}>
            <line
              x1="50" x2="725"
              y1={y(value)} y2={y(value)}
              stroke="#304156" strokeDasharray="4 5"
            />
            <text
              x="42" y={y(value) + 4}
              textAnchor="end" fill="#b2c2d4" fontSize="12"
            >
              {number(value)}
            </text>
          </g>
        })}

        <text x="10" y="18" fill="#b2c2d4" fontSize="12"> SPI</text>

        <line x1="50" x2="725" y1={y(0)} y2={y(0)} stroke="#a9bacd" strokeDasharray="6 4" />
        {rows.map((row, i) => <g key={row.month}>
          {row.status === 'ready' &&
            i > 0 && rows[i - 1].status === 'ready' &&
            <line
              x1={x(row.month - 1)}
              y1={y(rows[i - 1].mean_spi)}
              x2={x(row.month)}
              y2={y(row.mean_spi)}
              stroke="#ff856c" strokeWidth="2.5"
            />
          }

          {row.status === 'ready' &&
            <circle
              cx={x(row.month)}
              cy={y(row.mean_spi)}
              r={selectedMonth === row.month ? 7 : 4}
              fill="#ff856c"
            >
              <title>{row.label}: {number(row.mean_spi)}  SPI</title>
            </circle>
          }

          <text
            x={x(row.month)} y="231"
            textAnchor="middle" fill="#b2c2d4" fontSize="12"
          >
            {row.label}
          </text>
        </g>)}
      </svg>
    </div>

    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(115px,1fr))',
      gap: 8
    }}>
      {rows.map(row =>
        <button
          key={row.month}
          className="secondary-button"
          aria-pressed={selectedMonth === row.month}
          aria-label={`Show ${row.label} ${year} on map`}
          onClick={() => onSelect(`${year}-${String(row.month).padStart(2, '0')}`)}
          style={{
            display: 'block',
            textAlign: 'left',
            borderColor: selectedMonth === row.month ? '#ff856c' : undefined
          }}
        >
          <strong>
            {row.label} · {row.status === 'ready'
              ? `${number(row.mean_spi)} SPI`
              : row.status === 'no_data'
                ? 'No data'
                : row.status === 'error' ? 'Failed' : '—'}
          </strong>
          <small style={{ display: 'block', marginTop: 5 }}>
            {row.status === 'ready'
              ? `${row.valid_area_percent.toFixed(2)}% valid · ${row.dry_area_percent_of_valid.toFixed(2)}% dry`
              : row.status === 'error'
                ? row.error
                : row.status === 'no_data'
                  ? 'No valid SPI estimates'
                  : 'Not loaded'}
          </small>
        </button>
      )}
    </div>

    <p>
      Click a month to update the map. Gaps mean missing, failed or unloaded
      months; they are never treated as zero. CSV includes all 12 months
      with their status.
    </p>
    <small>
      CHIRPS v2 Final · SPI-3 · Reference 1991–2020 · Approximately 5.6 km. Each point is the area-weighted mean of valid pixel SPI for the three months ending in that month. Dry area means SPI ≤ −1, as a percentage of valid area. Coverage can vary. This is not SPI fitted to statewide rainfall and is not a forecast.
    </small>
  </section>
}
