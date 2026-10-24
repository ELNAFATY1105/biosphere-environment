import { useEffect, useRef, useState } from 'react'
import './App.css'
import Reports from './Reports.jsx'
import MapView from './MapView.jsx'
import { useFlood, FloodKPI, FloodControls } from './Flood.jsx'
import { useCarbon, CarbonSummary, carbonNumber } from './Carbon.jsx'
import SPITrend from './SPITrend.jsx'
import { useSPI, SPIControls, spiNumber } from './SPI.jsx'
import HeatTrend from './HeatTrend.jsx'
import { useHeat, HeatControls, heatNumber } from './Heat.jsx'
import MapTimeline from './MapTimeline.jsx'
import { useForestStats, ForestStatsChart, formatHectares } from './ForestStats.jsx'
// All five indicators use their connected Earth Engine APIs.
const MODULES = [
  { id: 'heat', name: 'Heat', title: 'Surface temperature', icon: 'heat', value: '—', unit: '°C', color: '#ff333e' },
  { id: 'forest', name: 'Forest', title: 'Tree-cover loss', icon: 'forest', value: '—', unit: 'ha', color: '#00d875' },
  { id: 'carbon', name: 'Carbon', title: 'Living-biomass carbon', icon: 'carbon', value: '—', unit: 'Mt C', color: '#03c9d1' },
  { id: 'drought', name: 'Drought', title: 'SPI-3', icon: 'drought', value: '—', unit: '', color: '#ffb500' },
  { id: 'floods', name: 'Floods', title: 'River flood inundation', icon: 'floods', value: '—', unit: 'ha', color: '#259bff' },
]
const PATHS = {
  home: ['M3 10 12 3l9 7', 'M5 9v12h5v-7h4v7h5V9'],
  grid: ['M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
  heat: ['M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z', 'M12 7v10 M18 5h3 M18 9h2'],
  forest: ['M8 2 2 11h3l-4 6h6v5h2v-5h6l-4-6h3Z', 'M17 2 13 8h3l-2 4h3v9h2v-9h4l-3-4h3Z'],
  leaf: ['M20 3C7 1 2 8 5 16c8 7 16-1 15-13Z', 'M3 22 16 9'],
  carbon: ['M7 18a5 5 0 1 1-1-10 6 6 0 0 1 11-2 5 5 0 1 1 1 12Z'],
  drought: ['M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2', 'M9 8 7 12l4 2-1 4 6-6-4-2 2-4'],
  floods: ['M2 7q3-4 6 0t6 0t8 0 M2 12q3-4 6 0t6 0t8 0 M2 17q3-4 6 0t6 0t8 0'],
  map: ['M2 5 8 2l8 3 6-3v17l-6 3-8-3-6 3Z M8 2v17 M16 5v17'],
  layers: ['M2 8 12 2l10 6-10 6Z M2 12l10 6 10-6 M2 16l10 6 10-6'],
  chart: ['M3 3v18h19 M7 15l5-7 4 4 5-8'],
  report: ['M5 2h10l5 5v15H5Z M15 2v6h5 M8 12h8 M8 16h8'],
  cube: ['M12 2 2 7v10l10 5 10-5V7Z M2 7l10 5 10-5 M12 12v10 M7 4l10 5'],
  download: ['M12 2v13 M7 10l5 5 5-5 M3 16v5h18v-5'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'm9 2-1 3-3 1-3 3 2 3-2 3 3 3 3 1 1 3h6l1-3 3-1 3-3-2-3 2-3-3-3-3-1-1-3Z'],
  search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l7 7'],
  bell: ['M5 17V9a7 7 0 0 1 14 0v8l2 2H3Z M9 22h6'],
  pin: ['M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13Z', 'M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  target: ['M12 2v4 M12 18v4 M2 12h4 M18 12h4', 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  expand: ['M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6'],
  share: ['M17 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M5 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M17 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M8 10l6-3 M8 14l6 3'],
  close: ['m5 5 14 14 M19 5 5 19'],
}
function Icon({ name, size = 20, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{(PATHS[name] || PATHS.grid).map((path, i) => <path key={i} d={path} />)}{name === 'carbon' && <text x="7" y="15" fontSize="6" fill="currentColor" stroke="none">CO₂</text>}</svg> }
const SERIES = {
  heat: { label: 'Land surface temperature', unit: '°C', detail: 'Surface temperature is different from air temperature.' },
  forest: { label: 'Annual tree-cover loss', unit: 'ha', detail: 'Satellite-derived annual loss in Gombe State. Not remaining forest cover or confirmed deforestation.' },
  carbon: { label: 'Living-biomass carbon', unit: 'Mt C', detail: 'Historical 2010 baseline from NASA/ORNL. Aboveground and belowground living biomass; excludes soil carbon.' },
  drought: { label: 'Standardized Precipitation Index', unit: 'SPI-3', detail: 'Three-month rainfall conditions relative to 1991–2020. CHIRPS v2 Final.' },
  floods: { label: 'River flood hazard', detail: 'JRC / CEMS modelled river inundation scenarios. Not an observed event or live warning.' },
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current.close() }}>
    <div className="modal-title"><h2>{title}</h2><button className="icon-button" onClick={() => ref.current.close()} aria-label="Close dialog"><Icon name="close" /></button></div>
    {children}
  </dialog>
}
function getInitialModule() {
  const id = new URLSearchParams(window.location.search).get('module')
  return MODULES.some((m) => m.id === id) ? id : 'overview'
}
export default function App() {
  const [active, setActive] = useState(getInitialModule)
  const [query, setQuery] = useState('')
  const [mapTarget, setMapTarget] = useState(null)
  const [terrainEnabled, setTerrainEnabled] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [trendId, setTrendId] = useState('heat')
  const [mapYears, setMapYears] = useState({ forest: 2025, drought: 2025 })
  const forestStats = useForestStats()
  const heat = useHeat()
  const spi = useSPI()
  const carbon = useCarbon()
  const flood = useFlood()
  const forestRow = forestStats.data?.annual?.find(row => row.year === mapYears.forest)
  const timelineModule = ['heat', 'forest', 'drought', 'carbon', 'floods'].includes(active) ? active : null
  const selected = MODULES.find((m) => m.id === active)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!navOpen) return
    const close = (e) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [navOpen])
  function selectModule(id) {
    setActive(id)
    if (id !== 'overview') setTrendId(id)
    setNavOpen(false)
  }
  function search(e) {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    if (!q) return
    const match = MODULES.find((m) => m.name.toLowerCase() === q)
    if (match) { selectModule(match.id); return }
    if (q === 'gombe' || q === 'gombe city') {
      setMapTarget({ lat: 10.29, lng: 11.21, label: 'Gombe city centre (approximate)', request: Date.now() }); return
    }
    const parts = q.split(',').map((part) => part.trim())
    const lat = Number(parts[0]), lng = Number(parts[1])
    if (parts.length === 2 && parts.every(Boolean) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
      setMapTarget({ lat, lng, label: 'Searched coordinate', request: Date.now() }); return
    }
    setNotice('Enter Gombe, a module name, or latitude, longitude — for example 10.29, 11.21.')
  }
  function downloadReport() {
    setDialog({ kind: 'reports', title: 'Reports & downloads' })
  }
  async function shareView() {
    const url = new URL(window.location.href)
    url.searchParams.set('module', active)
    try { await navigator.clipboard.writeText(url.toString()); setNotice('Dashboard link copied. Map position is not included.') }
    catch { setDialog({ title: 'Copy dashboard link', kind: 'share', url: url.toString() }) }
  }
  function openSources() { setNavOpen(false); setDialog({ title: 'Data sources & status', kind: 'sources' }) }
  return <div className="dashboard">
    <a className="skip-link" href="#main-content">Skip to dashboard</a>
    <aside className={`sidebar ${navOpen ? 'nav-open' : ''}`} id="main-navigation">
      <button className="brand-button" onClick={() => selectModule('overview')} aria-label="BIOSPHERECONSULT overview">
        <span className="brand-logo-frame"><img src={`${import.meta.env.BASE_URL}biosphere-logo.png`} alt="BIOSPHERECONSULT logo" /></span>
        <span className="brand-wordmark"><strong>BIOSPHERE<span>CONSULT</span></strong><small>ENVIRONMENT & CLIMATE</small></span>
      </button>
      <div className="workspace-label"><span className="workspace-dot" /> Research workspace</div>
      <nav aria-label="Main navigation">
        <p className="nav-section">MONITORING</p>
        <button className={`nav-button ${active === 'overview' ? 'is-active' : ''}`} aria-current={active === 'overview' ? 'page' : undefined} onClick={() => selectModule('overview')}><Icon name="grid" />Overview</button>
        {MODULES.map((m) => <button key={m.id} className={`nav-button ${active === m.id ? 'is-active' : ''}`} aria-current={active === m.id ? 'page' : undefined} onClick={() => selectModule(m.id)}><Icon name={m.icon} />{m.name}</button>)}
        <p className="nav-section tools-label">WORKSPACE</p>
        <button className="nav-button" onClick={openSources}><Icon name="layers" />Data sources</button>
        <button className="nav-button" onClick={() => { setNavOpen(false); setDialog({ title: 'Reports & downloads', kind: 'reports' }) }}><Icon name="report" />Reports & downloads</button>
      </nav>
      <div className="sidebar-bottom"><Icon name="pin" size={17} /><div><strong>Gombe State</strong><small>Nigeria · Research prototype</small></div></div>
    </aside>
    {navOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
    <div className="workspace-main">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-controls="main-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}><Icon name="grid" /></button><span>Environment & Climate</span><span className="breadcrumb-divider">/</span><strong>{selected?.name || 'Overview'}</strong></div>
        <form className="search-box" onSubmit={search}><button type="submit" aria-label="Search"><Icon name="search" size={18} /></button><input aria-label="Search location or module" placeholder="Gombe or coordinates…" value={query} onChange={(e) => setQuery(e.target.value)} /></form>
        <span className="avatar" title="Aliyu Elnafaty · Local research workspace">AE</span>
      </header>
      <main className="main" id="main-content">
        <div className="page-heading"><div><p className="eyebrow">BIOSPHERECONSULT LTD</p><h1>{selected ? `${selected.name} monitoring` : 'Environment overview'}</h1><p className="page-subtitle">{selected ? SERIES[selected.id].detail : 'A focused view of environmental conditions across Gombe State.'}</p></div><button className="secondary-button" onClick={downloadReport}><Icon name="download" size={17} />Reports & downloads</button></div>
        <div className="data-notice"><span className="demo-badge">DATA SOURCES</span><p>All five indicators use Earth Engine datasets. Carbon is a 2010 baseline; Floods shows modelled river hazard. Heat supports LGA selection; other indicators remain statewide. No automated alert service is connected.</p><button onClick={openSources}>Data status <span aria-hidden="true">↗</span></button></div>
        <section className="kpi-grid" aria-label="Environmental indicators from Earth Engine; river flood hazard is modelled">
          {MODULES.map((m) => m.id === 'floods' ? <FloodKPI key={m.id} flood={flood} active={active === 'floods'} onSelect={() => selectModule('floods')} /> : m.id === 'carbon' ? <button key={m.id} className={`kpi ${active === 'carbon' ? 'selected' : ''}`} style={{ '--accent': m.color }} onClick={() => selectModule('carbon')} aria-pressed={active === 'carbon'}><span className="kpi-top"><span>Living-biomass carbon</span><Icon name="carbon" size={19} /></span><span className="kpi-value">{carbonNumber(carbon.data?.total_MtC)}<small>Mt C</small></span><span className="kpi-caption">{carbon.loading ? 'Loading carbon…' : carbon.error ? 'Unavailable · open Carbon' : '2010 baseline · NASA/ORNL'}</span></button> : m.id === 'drought' ? <button key={m.id} className={`kpi ${active === 'drought' ? 'selected' : ''}`} style={{ '--accent': m.color }} onClick={() => selectModule('drought')} aria-pressed={active === 'drought'}><span className="kpi-top"><span>Mean pixel SPI-3</span><Icon name="drought" size={19} /></span><span className="kpi-value">{spiNumber(spi.data?.mean_spi)}</span><span className="kpi-caption">{spi.loading ? 'Loading SPI…' : spi.error ? 'Unavailable · open Drought' : `${spi.period} · CHIRPS`}</span></button> : m.id === 'heat' ? <button key={m.id} className={`kpi ${active === 'heat' ? 'selected' : ''}`} style={{ '--accent': m.color }} onClick={() => selectModule('heat')} aria-pressed={active === 'heat'}><span className="kpi-top"><span>Surface temperature</span><Icon name="heat" size={19} /></span><span className="kpi-value">{heatNumber(heat.data?.mean_lst_c)}<small>°C</small></span><span className="kpi-caption">{heat.loading ? 'Loading heat…' : heat.error ? 'Unavailable · open Heat' : `${heat.period} · ${heat.regionName} · MODIS`}</span></button> : m.id === 'forest' ? <button key={m.id} className={`kpi ${active === 'forest' ? 'selected' : ''}`} style={{ '--accent': '#ff8f86' }} onClick={() => selectModule('forest')} aria-pressed={active === 'forest'} aria-label={`Tree-cover loss ${mapYears.forest}: ${forestStats.loading ? 'loading' : forestStats.error ? 'unavailable' : formatHectares(forestRow?.loss_ha) + ' hectares'}`}><span className="kpi-top"><span>Tree-cover loss</span><Icon name="forest" size={19} /></span><span className="kpi-value">{formatHectares(forestRow?.loss_ha)}<small>ha</small></span><span className="kpi-caption">{forestStats.loading ? 'Loading statistics…' : forestStats.error ? 'Unavailable · see forest chart' : `${mapYears.forest} · Hansen GFC`}</span></button> : <button key={m.id} className={`kpi ${active === m.id ? 'selected' : ''}`} style={{ '--accent': m.color }} onClick={() => selectModule(m.id)} aria-pressed={active === m.id} aria-label={`${m.name}: ${m.value} ${m.unit}, demo value`}><span className="kpi-top"><span>{m.title === 'Urban Heat' ? 'Surface temperature' : m.title}</span><Icon name={m.icon} size={19} /></span><span className="kpi-value">{m.value}<small>{m.unit}</small></span><span className="kpi-caption">{m.id === 'floods' ? 'Illustrative risk class' : m.id === 'carbon' ? 'Estimated stock · illustrative' : 'Illustrative indicator'}</span></button>)}
        </section>
        <section className="primary-grid">
          <article className="panel map-card"><div className="panel-heading"><div><h2>Explore Gombe</h2><p>Satellite, streets & terrain</p></div><button className="icon-button" aria-label="Copy dashboard link" onClick={shareView}><Icon name="share" size={18} /></button></div><div className="map-mode-tabs" aria-label="Map display"><button className={!timelineModule ? 'active' : ''} aria-pressed={!timelineModule} onClick={() => selectModule('overview')}>Basemap</button><button className={timelineModule === 'heat' ? 'active' : ''} aria-pressed={timelineModule === 'heat'} onClick={() => selectModule('heat')}>Heat map</button><button className={timelineModule === 'forest' ? 'active' : ''} aria-pressed={timelineModule === 'forest'} onClick={() => selectModule('forest')}>Forest change</button><button className={timelineModule === 'drought' ? 'active' : ''} aria-pressed={timelineModule === 'drought'} onClick={() => selectModule('drought')}>Drought SPI-3</button><button className={timelineModule === 'carbon' ? 'active' : ''} aria-pressed={timelineModule === 'carbon'} onClick={() => selectModule('carbon')}>Carbon 2010</button><button className={timelineModule === 'floods' ? 'active' : ''} aria-pressed={timelineModule === 'floods'} onClick={() => selectModule('floods')}>River flood hazard</button></div><div className="map-panel"><MapView flood={flood} carbon={carbon} spi={spi} heat={heat} target={mapTarget} layersOpen={layersOpen} onLayersChange={setLayersOpen} terrainEnabled={terrainEnabled} onTerrainChange={setTerrainEnabled} timelineModule={timelineModule} timelineYear={mapYears[timelineModule]} /></div>{timelineModule === 'floods' && <FloodControls flood={flood} />}{timelineModule === 'carbon' && <CarbonSummary carbon={carbon} />}{timelineModule === 'heat' && <HeatControls heat={heat} />}{timelineModule === 'drought' && <SPIControls spi={spi} />}{timelineModule === 'forest' && <MapTimeline key={timelineModule} module={timelineModule} year={mapYears[timelineModule]} onYearChange={(year) => setMapYears((previous) => ({ ...previous, [timelineModule]: year }))} />}</article>
        </section>
        <details className="insights-fold trend-fold"><summary>Indicator analysis <span>View details</span></summary><section className="panel trend-panel"><div className="panel-heading"><div><h2>Indicator analysis</h2><p>{trendId === 'floods' ? 'River hazard scenarios · Not an annual time series' : trendId === 'carbon' ? 'Historical carbon baseline · 2010 only' : trendId === 'drought' ? 'SPI-3 · Three-month windows · Reference 1991–2020' : trendId === 'heat' ? `Monthly satellite-derived temperature · ${heat.regionName}` : trendId === 'forest' ? 'Gombe State · Annual detected loss · 2015–2025' : ''}</p></div><label className="trend-select"><span>Indicator</span><select aria-label="Trend indicator" value={trendId} onChange={(e) => setTrendId(e.target.value)}>{MODULES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>{trendId === 'floods' ? <FloodControls flood={flood} /> : trendId === 'carbon' ? <CarbonSummary carbon={carbon} /> : trendId === 'drought' ? <SPITrend spi={spi} onSelect={period => { spi.setPeriod(period); selectModule('drought') }} /> : trendId === 'heat' ? <HeatTrend heat={heat} onSelect={period => { heat.setPeriod(period); selectModule('heat') }} /> : trendId === 'forest' ? <ForestStatsChart stats={forestStats} year={mapYears.forest} onYearChange={year => { setMapYears(previous => ({ ...previous, forest: year })); selectModule('forest') }} /> : null}</section></details>
        <footer className="page-footer"><span>© BIOSPHERECONSULT LTD</span><span>Gombe State · Environment & Climate Monitoring</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {dialog && <Modal title={dialog.title} onClose={() => setDialog(null)}>
      {dialog.kind === 'sources' && <><p>The basemap uses Mapbox imagery, street tiles and optional elevation. Imagery is not a live environmental observation.</p><div className="source-list">{MODULES.map((m) => <div key={m.id}><span>{m.name}</span><span className="muted">{m.id === 'floods' ? 'JRC / CEMS river flood hazard API · Scenario model' : m.id === 'carbon' ? 'NASA/ORNL living-biomass carbon API · 2010' : m.id === 'drought' ? 'SPI-3 / CHIRPS API configured; reference 1991–2020' : m.id === 'heat' ? 'Monthly MODIS daytime temperature API configured' : m.id === 'forest' ? 'Annual loss map and statistics API configured' : 'Dataset not connected'}</span></div>)}</div><p>Forest tiles and annual hectares use Hansen GFC via Earth Engine. Heat uses monthly MODIS daytime surface temperature. Drought uses SPI-3 from CHIRPS. Carbon uses the NASA/ORNL 2010 historical baseline. Floods uses JRC / CEMS modelled river hazard. Heat supports LGA selection; other indicators remain statewide. No automated alert service is connected.</p></>}
      {dialog.kind === 'reports' && <Reports active={active} forestStats={forestStats} forestYear={mapYears.forest} heat={heat} spi={spi} carbon={carbon} flood={flood} />}
      {dialog.kind === 'share' && <><p>Copy this dashboard link. Map position is not included.</p><input className="share-input" aria-label="Current view link" readOnly value={dialog.url} onFocus={(e) => e.target.select()} /></>}
    </Modal>}
  </div>
}
