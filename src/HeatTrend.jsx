import { useEffect, useRef, useState } from 'react'

import { HEAT_API as API, validateHeat } from './Heat.jsx'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const blankRows = () => MONTHS.map((label, index) => ({ month: index + 1, label, status: 'pending' }))
const number = value => Number.isFinite(value) ? value.toFixed(1) : '—'

export default function HeatTrend({ heat, onSelect }) {
  const year = Number(heat.period.slice(0, 4))
  const lgaCode = heat.lgaCode ?? null
  const scope = `${year}:${lgaCode ?? 'state'}`
  const regionName = heat.regionName || 'All Gombe State'
  const selectedMonth = Number(heat.period.slice(5))
  const [result, setResult] = useState({ scope, rows: blankRows() })
  const [busy, setBusy] = useState(false)
  const job = useRef(null)
  const rows = result.scope === scope ? result.rows : blankRows()

  useEffect(() => {
    job.current?.abort()
    job.current = null
    setBusy(false)
    setResult({ scope, rows: blankRows() })
    return () => { job.current?.abort(); job.current = null }
  }, [scope])

  async function load() {
    job.current?.abort()
    const controller = new AbortController()
    job.current = controller
    setBusy(true)
    const next = blankRows()
    setResult({ scope, rows: [...next] })
    for (let month = 1; month <= 12; month++) {
      if (controller.signal.aborted) break
      const request = new AbortController()
      const cancel = () => request.abort()
      controller.signal.addEventListener('abort', cancel, { once: true })
      const timeout = setTimeout(cancel, 180000)
      try {
        const response = await fetch(`${API}/api/heat/${year}/${month}${lgaCode === null ? '' : `?lga_code=${lgaCode}`}`, { signal: request.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = validateHeat(await response.json(), year, month, lgaCode)
        if (data.year !== year || data.month !== month || data.unit !== '°C' || !['ready', 'no_data'].includes(data.status)) throw new Error('Unexpected API response')
        if (data.status === 'ready' && ![data.mean_lst_c, data.valid_area_percent, data.mean_valid_days].every(Number.isFinite)) throw new Error('Invalid statistics')
        next[month - 1] = {
          ...next[month - 1], ...data,
          mean_lst_c: data.status === 'ready' ? data.mean_lst_c : null,
          label: MONTHS[month - 1]
        }
      } catch (error) {
        if (controller.signal.aborted) break
        next[month - 1] = { ...next[month - 1], status: 'error', error: error.name === 'AbortError' ? 'Request timed out' : error.message }
      } finally {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', cancel)
      }
      if (job.current === controller) setResult({ scope, rows: [...next] })
    }
    if (job.current === controller) { job.current = null; setBusy(false) }
  }

  function stop() { job.current?.abort(); job.current = null; setBusy(false) }
  function download() {
    const fields = ['region', 'lga_code', 'boundary', 'year', 'month', 'status', 'mean_lst_c', 'valid_area_percent', 'mean_valid_days', 'available_daily_images', 'dataset', 'attribution', 'method', 'quality_filter', 'coverage_note', 'note', 'computed_at', 'error']
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = [fields.join(','), ...rows.map(row => fields.map(field => quote(field === 'year' ? year : field === 'region' ? (row.region || regionName) : field === 'lga_code' ? lgaCode : field === 'boundary' ? (row.boundary || (lgaCode === null ? 'FAO/GAUL/2025/level1' : 'FAO/GAUL/2025/level2')) : row[field])).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url; link.download = `gombe-${lgaCode === null ? 'state' : `lga-${lgaCode}`}-monthly-daytime-lst-${year}.csv`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const valid = rows.filter(row => row.status === 'ready')
  const completed = rows.filter(row => row.status !== 'pending').length
  const failures = rows.filter(row => row.status === 'error').length
  const low = valid.length ? Math.floor(Math.min(...valid.map(row => row.mean_lst_c)) / 5) * 5 - 5 : 20
  const high = valid.length ? Math.ceil(Math.max(...valid.map(row => row.mean_lst_c)) / 5) * 5 + 5 : 60
  const x = month => 55 + (month - 1) * 59
  const y = value => 205 - (value - low) / (high - low) * 165

  return <section style={{ padding: 18, minWidth: 0 }} aria-label="Monthly Heat trend">
    <div className="map-toolbar" style={{ flexWrap: 'wrap' }}>
      <strong>{regionName} · Daytime surface temperature · {year}</strong>
      <button className="secondary-button" disabled={busy} onClick={load}>{completed ? 'Reload monthly trend' : 'Load monthly trend'}</button>
      {busy && <button className="secondary-button" onClick={stop}>Stop loading</button>}
      <button className="secondary-button" disabled={busy || completed !== 12} onClick={download}>Download heat CSV</button>
    </div>
    <p role="status">{busy ? `Loading monthly statistics: ${completed}/12 complete…` : completed ? `${completed}/12 months processed. ${valid.length} with observations; ${failures} failed.` : 'Load the selected year to calculate January–December. Change the year or area using the Heat controls below the map.'}</p>
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox="0 0 760 245" style={{ display: 'block', width: '100%', minWidth: 620 }} role="img" aria-label={`Monthly daytime land surface temperature in degrees Celsius for ${regionName}, ${year}. Missing months have gaps.`}>
        {[0, 1, 2, 3, 4].map(i => {
          const value = low + (high - low) * i / 4
          return <g key={i}><line x1="50" x2="725" y1={y(value)} y2={y(value)} stroke="#304156" strokeDasharray="4 5" /><text x="42" y={y(value) + 4} textAnchor="end" fill="#b2c2d4" fontSize="12">{number(value)}</text></g>
        })}
        <text x="10" y="18" fill="#b2c2d4" fontSize="12">°C</text>
        {rows.map((row, i) => <g key={row.month}>
          {row.status === 'ready' && i > 0 && rows[i - 1].status === 'ready' && <line x1={x(row.month - 1)} y1={y(rows[i - 1].mean_lst_c)} x2={x(row.month)} y2={y(row.mean_lst_c)} stroke="#ff856c" strokeWidth="2.5" />}
          {row.status === 'ready' && <circle cx={x(row.month)} cy={y(row.mean_lst_c)} r={selectedMonth === row.month ? 7 : 4} fill="#ff856c"><title>{row.label}: {number(row.mean_lst_c)} °C</title></circle>}
          <text x={x(row.month)} y="231" textAnchor="middle" fill="#b2c2d4" fontSize="12">{row.label}</text>
        </g>)}
      </svg>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(115px,1fr))', gap: 8 }}>
      {rows.map(row => <button key={row.month} className="secondary-button" aria-pressed={selectedMonth === row.month} aria-label={`Show ${row.label} ${year} on map`} onClick={() => onSelect(`${year}-${String(row.month).padStart(2, '0')}`)} style={{ display: 'block', textAlign: 'left', borderColor: selectedMonth === row.month ? '#ff856c' : undefined }}>
        <strong>{row.label} · {row.status === 'ready' ? `${number(row.mean_lst_c)}°C` : row.status === 'no_data' ? 'No data' : row.status === 'error' ? 'Failed' : '—'}</strong>
        <small style={{ display: 'block', marginTop: 5 }}>{row.status === 'ready' ? `${row.valid_area_percent.toFixed(2)}% area · ${number(row.mean_valid_days)} days` : row.status === 'error' ? row.error : row.status === 'no_data' ? 'No accepted observations' : 'Not loaded'}</small>
      </button>)}
    </div>
    <p>Click a month to update the map. Gaps mean missing, failed or unloaded months; they are never treated as zero. CSV includes all 12 months with their status.</p>
    <small>NASA MOD11A1.061 · Approximately 1 km · Quality-filtered daytime surface temperature, not air temperature or an all-weather monthly average. Coverage and observation counts vary between months. No annual average is calculated.</small>
  </section>
}
