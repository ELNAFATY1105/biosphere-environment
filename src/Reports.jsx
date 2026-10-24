import { useState } from 'react'
import { captureReportMap } from './MapView.jsx'

const LABELS = { heat: 'Heat', forest: 'Forest', drought: 'Drought', carbon: 'Carbon', floods: 'Floods' }
const finite = value => typeof value === 'number' && Number.isFinite(value)
const display = value => value == null ? 'Not available' : typeof value === 'number' ? value.toLocaleString('en-GB', { maximumFractionDigits: 3 }) : String(value)
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function buildReport(id, state, forestYear) {
  const d = state?.data
  if (state?.loading) return { error: 'Results are loading. Wait for the indicator to finish.' }
  if (state?.error || !d) return { error: 'Results are unavailable. Open this indicator and retry loading its data.' }
  if (d.status !== 'ready') return { error: d.status === 'no_data' ? 'No valid results for this selection. Missing data must not be reported as zero.' : 'This indicator is not ready to export.' }
  let period, rows, expected, title
  if (id === 'heat') {
    period = state.period
    expected = d.period === period && d.lga_code === (state.lgaCode ?? null) && finite(d.mean_lst_c)
    title = 'Monthly daytime land surface temperature'
    rows = [['Mean surface temperature', d.mean_lst_c, '°C'], ['Valid area', d.valid_area_percent, '%'], ['Mean accepted observation days', d.mean_valid_days, 'days'], ['Available daily images', d.available_daily_images, 'images']]
  } else if (id === 'forest') {
    period = String(forestYear)
    const annual = d.annual?.find(row => row.year === forestYear)
    expected = finite(annual?.loss_ha)
    title = 'Annual detected tree-cover loss'
    rows = [['Detected tree-cover loss', annual?.loss_ha, 'ha']]
  } else if (id === 'drought') {
    period = state.period
    expected = d.period === period && finite(d.mean_spi)
    title = 'Three-month Standardized Precipitation Index'
    rows = [['Area-weighted mean pixel SPI-3', d.mean_spi, 'dimensionless'], ['Dry area (SPI ≤ −1) within valid area', d.dry_area_percent_of_valid, '%'], ['Valid area', d.valid_area_percent, '%']]
  } else if (id === 'carbon') {
    period = '2010'
    expected = d.year === 2010 && finite(d.total_MtC)
    title = 'Historical living-biomass carbon stock'
    rows = [['Total living-biomass carbon', d.total_MtC, 'Mt C'], ['Aboveground carbon', d.aboveground_tC, 't C'], ['Belowground carbon', d.belowground_tC, 't C'], ['Mean carbon density', d.mean_density_tC_ha, 't C/ha'], ['Valid area', d.valid_area_percent, '%']]
  } else if (id === 'floods') {
    period = `RP${state.period}`
    expected = d.return_period_years === Number(state.period) && finite(d.mapped_inundation_ha)
    title = 'Modelled river flood hazard scenario'
    rows = [['Return period', d.return_period_years, 'years'], ['Annual exceedance probability', d.annual_exceedance_probability_percent, '%'], ['Mapped inundation area', d.mapped_inundation_ha, 'ha'], ['Excluded flagged nonpermanent area', d.excluded_flagged_nonpermanent_ha, 'ha']]
  }
  if (!expected) return { error: 'The loaded results do not match the selected period, or a required value is missing. Reload this indicator before exporting.' }
  const notes = {
    heat: 'Surface temperature, not air temperature or an all-weather average. Cloud gaps are not filled.',
    forest: 'Gross detected tree-cover loss, not remaining forest cover, net change or confirmed deforestation. Regrowth is not included.',
    drought: 'Mean pixel SPI is not SPI fitted to statewide rainfall. Dry-area percentage uses valid area as its denominator. This is not a forecast.',
    carbon: 'Historical 2010 estimate, not current stock, emissions or sequestration. Excludes soil, dead wood and litter. Totals cover valid pixels only.',
    floods: 'Modelled river hazard, not an observed event, live warning or complete risk assessment. Blank areas are not proof of safety. Return period is not a calendar year.',
  }
  const meta = [['Region', d.region || 'Gombe State, Nigeria'], ['Period / scenario', period], ['Dataset', d.dataset || 'Not supplied by API'], ['Boundary', d.boundary || 'Not supplied by API'], ['Resolution', d.resolution || 'Not supplied by API'], ['Attribution', d.attribution || 'Not supplied by API'], ['Method', d.method || 'Not supplied by API'], ['API computed at (UTC)', d.computed_at || 'Not supplied by API']]
  if (id === 'drought') meta.push(['Reference period', d.baseline || 'Not supplied by API'])
  if (d.quality_filter || d.quality_rule) meta.push(['Quality rule', d.quality_filter || d.quality_rule])
  if (d.boundary_policy) meta.push(['Boundary policy', d.boundary_policy])
  if (d.coverage_note) meta.push(['Coverage', d.coverage_note])
  return { id, region: d.region || 'Gombe State, Nigeria', regionKey: id === 'heat' ? String(state.lgaCode ?? 'state') : 'state', title, period, rows, meta, note: [notes[id], d.note].filter(Boolean).join(' '), filename: `BIOSPHERECONSULT-Gombe-${id}-${period}${id === 'heat' ? `-${state.lgaCode ?? 'state'}` : ''}` }
}

function downloadCSV(report) {
  const generated = new Date().toISOString()
  const rows = [['section', 'field', 'value', 'unit'], ['report', 'title', report.title, ''], ['report', 'generated_at_utc', generated, ''], ...report.rows.map(([k, v, u]) => ['result', k, v ?? 'Not available', u]), ...report.meta.map(([k, v]) => ['metadata', k, v, '']), ['metadata', 'Interpretation', report.note, '']]
  const cell = value => {
    let text = String(value)
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `${report.filename}.csv`
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function printReport(report, snapshot) {
  let mapHTML = ''
  if (snapshot) {
    const bars = snapshot.gradients.map(gradient => {
      const colors = gradient.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi) || []
      if (colors.length < 2) return ''
      const canvas = document.createElement('canvas')
      canvas.width = 600; canvas.height = 18
      const context = canvas.getContext('2d')
      const ramp = context.createLinearGradient(0, 0, 600, 0)
      colors.forEach((color, index) => ramp.addColorStop(index / (colors.length - 1), color))
      context.fillStyle = ramp; context.fillRect(0, 0, 600, 18)
      return `<img alt="Indicator colour scale" src="${canvas.toDataURL()}" style="width:300px;max-width:100%;height:12px">`
    }).join('')
    mapHTML = `<section class="map-figure"><h2>Map · ${escape(snapshot.period)}</h2>
      <img class="report-map" alt="${escape(report.title)} map" src="${snapshot.image}">
      ${snapshot.scale ? `<div style="width:${snapshot.scale.width}%;border:2px solid #172d3b;border-top:0;text-align:center;font-size:10px">${escape(snapshot.scale.text)}</div>` : ''}
      <div class="attribution"><img alt="Mapbox" src="${escape(snapshot.logoURL)}" style="width:88px;height:23px;background:#34495e;border-radius:3px"> <span>${escape(snapshot.attribution)}</span></div>
      <div class="legend">${bars}${snapshot.forest ? '<span style="color:#ff4545">■</span> ' : ''}<p>${escape(snapshot.legend)}</p></div>
      <p class="map-detail">${escape(snapshot.basemap)} · ${escape(snapshot.view)} · Layer opacity ${Math.round(snapshot.opacity * 100)}%. Captured ${escape(snapshot.capturedAt)}.</p>
      <p class="map-detail">Map shows the current viewport. Statistics below cover ${escape(report.region)}, not just this visible area. Basemap imagery does not change to the indicator date. Map controls, inspection popups and the city-centre marker are omitted.</p></section>`
  }

  const page = window.open('', '_blank')
  if (!page) return false
  const rowHTML = report.rows.map(([k, v, u]) => `<tr><th>${escape(k)}</th><td>${escape(display(v))}</td><td>${escape(u)}</td></tr>`).join('')
  const metaHTML = report.meta.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')
  page.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(report.filename)}</title><style>body{font:14px/1.6 Arial,sans-serif;color:#172d3b;max-width:850px;margin:36px auto;padding:0 24px}header{border-bottom:3px solid #087b57;padding-bottom:16px}h1{font-size:24px}h2{font-size:18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #ccd7db;padding:10px}dt{font-weight:bold;margin-top:12px}dd{margin:0;overflow-wrap:anywhere}.note{background:#edf6f1;padding:16px}button{padding:12px 18px;background:#087b57;color:white;border:0;cursor:pointer}footer{margin-top:24px;color:#536471}.report-map{width:100%;height:auto;display:block;border:1px solid #ccd7db}.map-figure{break-inside:avoid}.attribution{display:flex;align-items:center;gap:8px;font-size:10px;margin-top:8px}.legend{padding:8px 0;font-size:11px}.legend p{margin:4px 0}.map-detail{font-size:10px;line-height:1.4}tr{break-inside:avoid}@page{size:A4;margin:18mm}@media print{body{margin:0;padding:0}button{display:none}}</style></head><body><button id="print">Print / Save as PDF</button><header><p>BIOSPHERECONSULT LTD · ENVIRONMENT & CLIMATE</p><h1>${escape(report.title)}</h1><p>${escape(report.region)} · ${escape(report.period)} · Research report</p></header>${mapHTML}<h2>Results</h2><table><thead><tr><th>Indicator</th><th>Value</th><th>Unit</th></tr></thead><tbody>${rowHTML}</tbody></table><h2>Interpretation</h2><p class="note">${escape(report.note)}</p><h2>Sources and method</h2><dl>${metaHTML}</dl><footer>Generated ${escape(new Date().toISOString())} (UTC). Display values rounded to at most three decimals; CSV preserves API numeric precision. ${snapshot ? 'Map captured from the dashboard at screen resolution.' : 'Statistics-only report; no map image included.'}</footer></body></html>`)
  page.document.close()
  const printButton = page.document.getElementById('print')
  printButton.disabled = true
  printButton.textContent = 'Preparing report images…'
  Promise.all([...page.document.images].map(img => img.decode())).then(() => {
    if (page.closed) return
    printButton.disabled = false
    printButton.textContent = 'Print / Save as PDF'
    printButton.onclick = () => page.print()
  }).catch(() => {
    if (!page.closed) printButton.textContent = 'An image failed to load. Close this tab and retry.'
  })
  page.opener = null
  page.focus()
  return true
}

export default function Reports({ active, forestStats, forestYear, heat, spi, carbon, flood }) {
  const [id, setId] = useState(LABELS[active] ? active : 'heat')
  const [message, setMessage] = useState('')
  const [includeMap, setIncludeMap] = useState(true)
  const state = { heat, forest: forestStats, drought: spi, carbon, floods: flood }[id]
  const report = buildReport(id, state, forestYear)
  return <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <p>Select an indicator. The report uses the period currently selected on your dashboard. Close this window to change that period.</p>
    <label style={{ display: 'grid', gap: 8, margin: '16px 0' }}>Report indicator
      <select aria-label="Report indicator" value={id} onChange={e => { setId(e.target.value); setMessage('') }} style={{ padding: 10, background: '#10283a', color: '#fff', border: '1px solid #436074', borderRadius: 6 }}>
        {Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    {report.error ? <p role="status">{report.error}</p> : <>
      <h3>{report.title}</h3><p>{report.period} · {report.region}</p>
      <dl style={{ margin: '16px 0' }}>{report.rows.map(([label, value, unit]) => <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid #355064' }}><dt style={{ fontSize: 12 }}>{label}</dt><dd style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600 }}>{display(value)} {value != null && unit}</dd></div>)}</dl>
      <p style={{ fontSize: 12, lineHeight: 1.6 }}>{report.note}</p>
      <details><summary style={{ cursor: 'pointer' }}>Sources and calculation details</summary><dl>{report.meta.map(([label, value]) => <div key={label} style={{ margin: '10px 0' }}><dt><strong>{label}</strong></dt><dd style={{ margin: 0, fontSize: 12 }}>{value}</dd></div>)}</dl></details>
    </>}
    <label style={{ display: 'flex', gap: 8, marginTop: 18 }}><input type="checkbox" checked={includeMap} onChange={e => { setIncludeMap(e.target.checked); setMessage('') }} />Include current map and legend in PDF</label>
    <p style={{ fontSize: 12 }}>For a map report, select the same indicator on the dashboard and wait for its tiles before opening Reports. Uncheck this option for statistics only.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
      <button className="secondary-button" disabled={!!report.error} onClick={() => {
        try {
          const snapshot = includeMap ? captureReportMap(id, report.period, report.regionKey) : null
          if (!printReport(report, snapshot)) setMessage('Allow pop-ups for this dashboard, then try again.')
          else setMessage('The report opened in a new tab. Click Print / Save as PDF there.')
        } catch (error) { setMessage(error.message || 'Map capture failed. Retry or uncheck Include current map.') }
      }}>Print / Save as PDF</button>
      <button className="secondary-button" disabled={!!report.error} onClick={() => downloadCSV(report)}>Download CSV</button>
    </div>
    <p style={{ fontSize: 12 }}>PDF includes statistics, source notes and the map when selected. Use the existing indicator charts for annual or monthly series CSV downloads.</p>
    {message && <p role="status">{message}</p>}
  </div>
}
