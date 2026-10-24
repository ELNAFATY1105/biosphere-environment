import {
  inspectCarbon,
  inspectHeat,
  inspectForest,
} from './carbonInspection.js'
import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import './MapView.css'
import useForestLayer from './useForestLayer.js'
import { useSPIMap, SPILegend } from './SPI.jsx'
import { useHeatMap, HeatLegend } from './Heat.jsx'
import { useCarbonMap, CarbonLegend } from './Carbon.jsx'
import { useFloodMap, FloodLegend } from './Flood.jsx'
let reportCapture = null

export function captureReportMap(id, period, regionKey) {
  if (!reportCapture) throw new Error('The map is not ready. Close Reports and wait for it to load.')
  return reportCapture(id, period, regionKey)
}

const KEY = (window.BIOSPHERE_CONFIG?.mapboxToken || import.meta.env.VITE_MAPBOX_TOKEN || '').trim()
const HAS_KEY = Boolean(
  KEY.startsWith('pk.') && !/YOUR_|PASTE_|REPLACE_/i.test(KEY),
)
const GOMBE = [11.21, 10.29]
const STYLES = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
}
function friendlyError(status) {
  if (status === 401 || status === 403) {
    return 'Mapbox rejected the request. Check your public token and allowed HTTP origins.'
  }
  if (status === 429) {
    return 'The map service usage limit was reached. Check your Mapbox usage dashboard.'
  }
  if (status === 404) {
    return 'This basemap style was not found. Try the other basemap.'
  }
  return 'The map could not finish loading. Check your connection and Mapbox account, then retry.'
}
export default function MapView({
  flood,
  carbon,
  spi,
  heat,
  target,
  layersOpen,
  onLayersChange,
  terrainEnabled,
  onTerrainChange,
  timelineModule,
  timelineYear = 2025,
}) {
  const container = useRef(null)
  const root = useRef(null)
  const instance = useRef(null)
  const popup = useRef(null)
  const marker = useRef(null)
  const timelineInfo = useRef(null)
  timelineInfo.current = {
    module: timelineModule,
    year: timelineYear,
    heatPeriod: heat?.period,
    heatLgaCode: heat?.lgaCode,
  }
  const handledTarget = useRef(null)
  const latestView = useRef({
    center: GOMBE,
    zoom: 10,
    pitch: 0,
    bearing: 0,
  })
  const [basemap, setBasemap] = useState('satellite')
  const basemapRef = useRef(basemap)
  basemapRef.current = basemap
  const appliedStyle = useRef(null)
  const [retry, setRetry] = useState(0)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [markerVisible, setMarkerVisible] = useState(true)
  const forestLayer = useForestLayer(
    instance, ready, timelineModule, timelineYear,
  )
  const heatStatus = useHeatMap(
    instance, ready, timelineModule === 'heat', heat,
  )
  const spiStatus = useSPIMap(
    instance, ready, timelineModule === 'drought', spi,
  )
  const carbonStatus = useCarbonMap(
    instance, ready, timelineModule === 'carbon', carbon,
  )
  const floodStatus = useFloodMap(
    instance, ready, timelineModule === 'floods', flood,
  )
  function inspect(map, lng, lat, label = 'Selected location') {
    const wrappedLng = ((lng + 180) % 360 + 360) % 360 - 180
    popup.current?.remove()
    const selected = timelineInfo.current
    if (selected.module === 'carbon') {
      popup.current = inspectCarbon(map, wrappedLng, lat)
      return
    }
    if (selected.module === 'heat' && selected.heatLgaCode == null) {
      popup.current = inspectHeat(
        map, wrappedLng, lat, selected.heatPeriod,
      )
      return
    }
    if (selected.module === 'forest') {
      popup.current = inspectForest(
        map, wrappedLng, lat, selected.year,
      )
      return
    }
    const content = document.createElement('div')
    const heading = document.createElement('strong')
    heading.textContent = label
    const position = document.createElement('p')
    position.textContent =
      `Latitude: ${lat.toFixed(5)}°\nLongitude: ${wrappedLng.toFixed(5)}°`
    const note = document.createElement('small')
    note.textContent =
      'WGS84 coordinates. Select an indicator to inspect its data.'
    if (selected.module === 'heat') note.textContent = 'Heat is filtered to the selected LGA. Pixel inspection for this area is paused; use the area summary below the map.'
    if (selected.module === 'drought') {
      note.textContent =
        'SPI-3 rainfall conditions. Pixel-value inspection is not connected yet.'
    }
    if (selected.module === 'floods') {
      note.textContent =
        'Modelled river flood hazard. Pixel-depth inspection is not connected yet.'
    }
    content.append(heading, position, note)
    popup.current = new mapboxgl.Popup({
      maxWidth: '255px',
      closeOnClick: false,
    })
      .setLngLat([lng, lat])
      .setDOMContent(content)
      .addTo(map)
  }
  useEffect(() => {
    if (!HAS_KEY || !container.current) return
    let disposed = false
    let map
    let resizeObserver
    setReady(false)
    setLoading(true)
    setError('')
    try {
      appliedStyle.current = basemapRef.current
      map = new mapboxgl.Map({
        container: container.current,
        accessToken: KEY,
        style: STYLES[basemapRef.current],
        projection: 'mercator',
        ...latestView.current,
        maxPitch: 65,
        maxZoom: 18,
        attributionControl: false,
        preserveDrawingBuffer: true,
      })
      instance.current = map
      map.addControl(
        new mapboxgl.NavigationControl({
          showZoom: true,
          showCompass: true,
        }),
        'top-left',
      )
      map.addControl(
        new mapboxgl.FullscreenControl({ container: root.current }),
        'top-left',
      )
      map.addControl(
        new mapboxgl.ScaleControl({
          maxWidth: 120,
          unit: 'metric',
        }),
        'bottom-left',
      )
      map.addControl(
        new mapboxgl.AttributionControl({ compact: true }),
        'bottom-right',
      )
      map.on('moveend', () => {
        const centre = map.getCenter()
        latestView.current = {
          center: [centre.lng, centre.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        }
      })
      map.on('click', event => {
        inspect(map, event.lngLat.lng, event.lngLat.lat)
      })
      map.on('error', event => {
        const sources = [
          'gee-forest', 'gee-heat', 'gee-spi',
          'gee-carbon', 'gee-flood',
        ]
        if (disposed || sources.includes(event.sourceId)) return
        setError(friendlyError(event.error?.status))
        setLoading(false)
      })
      map.on('style.load', () => {
        if (!disposed) setReady(true)
      })
      map.on('load', () => {
        if (disposed) return
        setReady(true)
        setLoading(false)
      })
      map.on('idle', () => {
        if (!disposed) setLoading(false)
      })
      resizeObserver = new ResizeObserver(() => map.resize())
      resizeObserver.observe(container.current)
    } catch (e) {
      setLoading(false)
      setError(
        e.message?.includes('WebGL')
          ? 'WebGL could not start. Enable browser hardware acceleration.'
          : friendlyError(),
      )
    }
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      popup.current?.remove()
      popup.current = null
      marker.current?.remove()
      marker.current = null
      map?.remove()
      if (instance.current === map) instance.current = null
    }
  }, [retry])
  useEffect(() => {
    const map = instance.current
    if (!map || appliedStyle.current === basemap) return
    appliedStyle.current = basemap
    setReady(false)
    setLoading(true)
    setError('')
    popup.current?.remove()
    map.setStyle(STYLES[basemap], { diff: false })
  }, [basemap])
  useEffect(() => {
    const map = instance.current
    if (!map || !ready) return
    marker.current?.remove()
    marker.current = null
    if (!markerVisible) return
    const button = document.createElement('button')
    button.className = 'gombe-marker'
    button.type = 'button'
    button.title = 'Gombe city centre (approximate)'
    button.setAttribute(
      'aria-label', 'Inspect approximate Gombe city centre',
    )
    button.textContent = 'G'
    button.addEventListener('click', event => {
      event.stopPropagation()
      inspect(
        map, GOMBE[0], GOMBE[1],
        'Gombe city centre (approximate)',
      )
    })
    marker.current = new mapboxgl.Marker({ element: button })
      .setLngLat(GOMBE)
      .addTo(map)
    return () => {
      marker.current?.remove()
      marker.current = null
    }
  }, [ready, markerVisible])
  useEffect(() => {
    const map = instance.current
    if (!map || !ready) return
    try {
      if (terrainEnabled) {
        if (!map.getSource('biosphere-dem')) {
          map.addSource('biosphere-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          })
        }
        map.setTerrain({
          source: 'biosphere-dem',
          exaggeration: 1,
        })
        map.easeTo({ pitch: 55, duration: 700 })
      } else {
        map.setTerrain(null)
        map.easeTo({ pitch: 0, duration: 500 })
      }
    } catch {
      setError(
        'Terrain could not be enabled. Use 2D and check your Mapbox terrain access.',
      )
    }
  }, [terrainEnabled, ready])
  useEffect(() => {
    const map = instance.current
    if (
      !map || !ready || !target ||
      handledTarget.current === target
    ) return
    handledTarget.current = target
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: 12,
      duration: 1000,
    })
    inspect(map, target.lng, target.lat, target.label)
  }, [target, ready])
  useEffect(() => {
    popup.current?.remove()
  }, [
    timelineModule, timelineYear,
    heat?.period, heat?.lgaCode, spi?.period, flood?.period,
  ])
  useEffect(() => {
    if (layersOpen) popup.current?.remove()
  }, [layersOpen])

  useEffect(() => {
    const capture = (id, period, regionKey = 'state') => {
      if (id === 'heat' && regionKey !== String(heat?.lgaCode ?? 'state')) throw new Error('The report area and map area do not match. Reopen Reports.')
      const map = instance.current
      const selectedPeriod = timelineModule === 'forest' ? String(timelineYear)
        : timelineModule === 'heat' ? heat?.period
        : timelineModule === 'drought' ? spi?.period
        : timelineModule === 'carbon' ? '2010' : `RP${flood?.period}`
      if (id !== timelineModule || String(period) !== selectedPeriod) {
        throw new Error('Select this indicator and period on the map first, then reopen Reports.')
      }
      if (!map || !ready || error || loading || map.isMoving() || !map.loaded() || !map.areTilesLoaded()) {
        throw new Error('The map is still loading or moving. Close Reports, wait for the tiles, then try again.')
      }
      const sources = { forest: 'gee-forest', heat: 'gee-heat', drought: 'gee-spi', carbon: 'gee-carbon', floods: 'gee-flood' }
      const source = sources[id]
      const style = map.getStyle()
      const layer = style.layers.find(item => item.source === source)
      if (!layer || layer.layout?.visibility === 'none' || !map.isSourceLoaded(source)) {
        throw new Error('The selected indicator layer is not loaded. Retry its map layer first.')
      }
      const dataset = { heat: heat?.data, drought: spi?.data, carbon: carbon?.data, floods: flood?.data }[id]
      if (id === 'forest') {
        if (forestLayer.status !== `Annual loss layer loaded · ${timelineYear}`) {
          throw new Error('Wait for the selected forest year to finish loading.')
        }
      } else if (dataset?.status !== 'ready' || !style.sources[source]?.tiles?.includes(dataset.tileUrl)) {
        throw new Error('Map tiles do not match the current results. Reload the indicator.')
      }
      const legend = root.current.querySelector('.map-legend-strip')
      if (!legend) throw new Error('The map legend is not available yet.')
      const gradients = [...legend.querySelectorAll('*')]
        .map(element => getComputedStyle(element).backgroundImage)
        .filter(value => value.startsWith('linear-gradient('))
      const logo = root.current.querySelector('.mapboxgl-ctrl-logo')
      const background = logo ? getComputedStyle(logo).backgroundImage : ''
      const logoURL = background.match(/^url\(["']?(data:image\/svg\+xml[^"']*)["']?\)$/)?.[1]
      if (!logoURL) throw new Error('Map attribution logo is not ready. Refresh the dashboard and retry.')
      const canvas = map.getCanvas()
      const image = canvas.toDataURL('image/png')
      if (!image.startsWith('data:image/png') || canvas.width === 0 || canvas.height === 0) {
        throw new Error('The map image could not be captured. Refresh the dashboard and retry.')
      }
      const scale = root.current.querySelector('.mapboxgl-ctrl-scale')
      const center = map.getCenter()
      return {
        image, logoURL, id, period: selectedPeriod,
        legend: [...legend.children].map(el => el.textContent.trim()).filter(Boolean).join(' · '),
        gradients: [...new Set(gradients)],
        forest: id === 'forest',
        attribution: '© Mapbox © OpenStreetMap · ' + (root.current.querySelector('.mapboxgl-ctrl-attrib-inner')?.textContent || ''),
        basemap: basemap === 'satellite' ? 'Satellite + labels' : 'Streets',
        view: `Centre ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)} · Zoom ${map.getZoom().toFixed(2)} · Bearing ${map.getBearing().toFixed(1)}° · Pitch ${map.getPitch().toFixed(1)}°`,
        opacity: map.getPaintProperty(layer.id, 'raster-opacity') ?? 1,
        scale: map.getPitch() === 0 && scale ? { text: scale.textContent, width: 100 * scale.getBoundingClientRect().width / canvas.getBoundingClientRect().width } : null,
        capturedAt: new Date().toISOString(),
      }
    }
    reportCapture = capture
    return () => { if (reportCapture === capture) reportCapture = null }
  })

  function resetView() {
    popup.current?.remove()
    onTerrainChange(false)
    instance.current?.flyTo({
      center: GOMBE,
      zoom: 10,
      pitch: 0,
      bearing: 0,
      duration: 800,
    })
  }
  return (
    <div ref={root} className="live-map-root">
      <div className="map-toolbar">
        <label className="basemap-picker">
          <span>Basemap</span>
          <select
            aria-label="Basemap"
            value={basemap}
            onChange={event => setBasemap(event.target.value)}
          >
            <option value="satellite">Satellite + labels</option>
            <option value="streets">Streets</option>
          </select>
        </label>
        <div className="map-toolbar-actions">
          <button onClick={resetView} disabled={!ready}>
            Reset view
          </button>
          <button
            aria-pressed={terrainEnabled}
            onClick={() => onTerrainChange(!terrainEnabled)}
            disabled={!ready}
          >
            {terrainEnabled ? 'Use 2D' : '3D terrain'}
          </button>
          <button
            aria-expanded={layersOpen}
            onClick={() => onLayersChange(!layersOpen)}
          >
            Layers
          </button>
        </div>
        {loading && !error && (
          <span className="map-loading-note" role="status">
            Loading tiles…
          </span>
        )}
      </div>
      <div className="map-viewport">
        <div
          ref={container}
          className="live-map-canvas"
          aria-label="Interactive map of Gombe"
        />
        {!HAS_KEY && (
          <div className="map-setup">
            <h2>Connect your basemap</h2>
            <p>
              Add your Mapbox public token to{' '}
              <code>.env.local</code>, then restart Vite.
            </p>
            <code className="key-example">
              VITE_MAPBOX_TOKEN=pk.YOUR_PUBLIC_TOKEN
            </code>
          </div>
        )}
      </div>
      {layersOpen && (
        <section
          className="map-layer-drawer"
          aria-label="Map layer controls"
        >
          <div className="drawer-heading">
            <strong>Layers</strong>
            <button
              aria-label="Close layers"
              onClick={() => onLayersChange(false)}
            >
              ×
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={markerVisible}
              onChange={event =>
                setMarkerVisible(event.target.checked)
              }
            />
            Gombe centre marker
          </label>
          <label>
            <input
              type="checkbox"
              checked={terrainEnabled}
              onChange={event =>
                onTerrainChange(event.target.checked)
              }
              disabled={!ready}
            />
            3D terrain
          </label>
          <small>
            Heat: monthly MODIS temperature. Forest: annual
            tree-cover loss. Drought: SPI-3, reference 1991–2020.
            Carbon: 2010 living-biomass baseline.
            Floods: modelled river hazard.
          </small>
        </section>
      )}
      {timelineModule === 'floods' && (
        <FloodLegend flood={flood} status={floodStatus} />
      )}
      {timelineModule === 'carbon' && (
        <CarbonLegend carbon={carbon} status={carbonStatus} />
      )}
      {timelineModule === 'heat' && (
        <HeatLegend heat={heat} status={heatStatus} />
      )}
      {timelineModule === 'forest' && (
        <>
          <div className="map-legend-strip">
            <strong>
              ANNUAL TREE-COVER LOSS · {timelineYear}
            </strong>
            <span style={{ color: '#ff4545' }}>
              ■ Red: loss in selected year
            </span>
            <small>Hansen GFC v1.13 · 2001–2025</small>
          </div>
          <div className="map-service-status" role="status">
            <span>{forestLayer.status}</span>
            <button onClick={forestLayer.retry}>
              Retry forest layer
            </button>
          </div>
        </>
      )}
      {timelineModule === 'drought' && (
        <SPILegend spi={spi} status={spiStatus} />
      )}
      {error && (
        <div className="map-service-status" role="status">
          <span>{error}</span>
          <button onClick={() => setRetry(value => value + 1)}>
            Retry map
          </button>
          <button
            aria-label="Dismiss map status"
            onClick={() => {
              onTerrainChange(false)
              setError('')
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}