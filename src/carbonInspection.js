import mapboxgl from 'mapbox-gl'

const API = (
  import.meta.env.VITE_EE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : window.location.origin)
).replace(/\/$/, '')

function inspectPixel(map, lng, lat, module, period) {
  const heat = module === 'heat'
  const forest = module === 'forest'

  const content = document.createElement('div')
  content.style.cssText =
    'width:210px;max-width:100%;box-sizing:border-box;' +
    'overflow-wrap:anywhere;font-size:12px;line-height:1.4'

  const heading = document.createElement('strong')
  heading.textContent = forest
    ? `Tree-cover loss · ${period}`
    : heat
      ? `Daytime LST · ${period}`
      : 'Carbon density · 2010'

  const position = document.createElement('p')
  position.style.cssText =
    'margin:4px 0 7px;font-size:10px;line-height:1.3'
  position.textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`

  const body = document.createElement('div')
  body.setAttribute('role', 'status')
  body.textContent = 'Reading pixel…'

  content.append(heading, position, body)

  const popup = new mapboxgl.Popup({
    maxWidth: '250px',
    closeOnClick: false,
  })
    .setLngLat([lng, lat])
    .setDOMContent(content)
    .addTo(map)

  const controller = new AbortController()
  let closed = false
  const timeout = setTimeout(() => controller.abort(), 90000)

  popup.on('close', () => {
    closed = true
    clearTimeout(timeout)
    controller.abort()
  })

  async function load() {
    try {
      const endpoint = forest
        ? `forest/${period}`
        : heat
          ? `heat/${period.split('-').map(Number).join('/')}`
          : 'carbon'

      const response = await fetch(
        `${API}/api/inspect/${endpoint}?lat=${lat}&lon=${lng}`,
        {
          signal: controller.signal,
          cache: 'no-store',
        },
      )

      if (!response.ok) {
        throw new Error(
          `Inspection API returned HTTP ${response.status}.`,
        )
      }

      const data = await response.json()
      if (closed) return

      const wrongPeriod = forest
        ? data.year !== Number(period) || data.unit !== 'loss detection'
        : heat
          ? data.period !== period || data.unit !== '°C'
          : data.year !== 2010 || data.unit !== 't C/ha'

      if (data.module !== module || wrongPeriod) {
        throw new Error('Unexpected inspection response.')
      }

      if (data.status === 'outside_region') {
        body.textContent = 'Outside the Gombe analysis boundary.'
        return
      }

      if (data.status === 'no_data') {
        body.textContent = data.reason === 'permanent_water'
          ? 'Permanent water: no land-loss assessment.'
          : 'No valid data here. Missing is not zero.'
        return
      }

      if (data.status !== 'ready') {
        throw new Error('Unexpected inspection status.')
      }

      const lines = []

      if (forest) {
        const lossYear = data.detected_loss_year
        const canopy = data.tree_cover_2000_percent

        if (
          typeof data.loss_in_selected_year !== 'boolean' ||
          (
            lossYear !== null &&
            (
              !Number.isInteger(lossYear) ||
              lossYear < 2001 ||
              lossYear > 2025
            )
          ) ||
          (
            canopy !== null &&
            (
              !Number.isFinite(canopy) ||
              canopy < 0 ||
              canopy > 100
            )
          ) ||
          data.loss_in_selected_year !== (lossYear === Number(period))
        ) {
          throw new Error('Invalid forest values.')
        }

        lines.push(
          `${period}: ${
            data.loss_in_selected_year
              ? 'Loss detected'
              : 'No detected loss'
          }`,
        )
        lines.push(
          `Recorded loss year: ${lossYear ?? 'None (2001–2025)'}`,
        )
        lines.push(
          `Canopy in 2000: ${
            canopy === null ? 'No data' : canopy.toFixed(0) + '%'
          }`,
        )
      } else if (heat) {
        if (
          !Number.isFinite(data.mean_lst_c) ||
          !Number.isInteger(data.valid_days) ||
          !Number.isInteger(data.available_daily_images) ||
          data.valid_days < 1 ||
          data.valid_days > data.available_daily_images
        ) {
          throw new Error('Invalid temperature values.')
        }

        lines.push(
          `Surface temperature: ${data.mean_lst_c.toFixed(1)} °C`,
        )
        lines.push(
          `Valid days: ${data.valid_days} / ${data.available_daily_images} images`,
        )
      } else {
        const fields = [
          ['Aboveground', 'aboveground_tC_ha'],
          ['Belowground', 'belowground_tC_ha'],
          ['Total', 'total_tC_ha'],
        ]

        if (
          fields.some(
            ([, key]) =>
              !Number.isFinite(data[key]) || data[key] < 0,
          )
        ) {
          throw new Error('Invalid carbon values.')
        }

        for (const [label, key] of fields) {
          lines.push(`${label}: ${data[key].toFixed(2)} t C/ha`)
        }
      }

      body.replaceChildren()

      for (const text of lines) {
        const line = document.createElement('div')
        line.textContent = text

        if (
          (forest && text === lines[0]) ||
          text.startsWith('Total:') ||
          text.startsWith('Surface temperature:')
        ) {
          line.style.fontWeight = '700'
        }

        body.append(line)
      }

      const source = document.createElement('p')
      source.style.cssText =
        'margin:7px 0 4px;font-size:10px;line-height:1.3'
      source.textContent = forest
        ? 'Hansen GFC v1.13 · ~30 m · GAUL 2025'
        : heat
          ? 'NASA MODIS · ~1 km · GAUL 2025'
          : 'NASA/ORNL · ~300 m · GAUL 2025'

      const note = document.createElement('small')
      note.textContent = forest
        ? 'No loss does not prove current forest. Loss is not necessarily deforestation.'
        : heat
          ? 'Monthly mean of accepted daytime observations. Surface, not air temperature; cloud gaps remain.'
          : 'Modelled living biomass; excludes soil and dead matter.'

      body.append(source, note)
    } catch (error) {
      if (!closed) {
        body.textContent = error.name === 'AbortError'
          ? 'Request timed out. Click again to retry.'
          : `${error.message} Check the backend and click again.`
      }
    } finally {
      clearTimeout(timeout)
      if (!closed) popup.setDOMContent(content)
    }
  }

  load()
  return popup
}

export function inspectCarbon(map, lng, lat) {
  return inspectPixel(map, lng, lat, 'carbon', '2010')
}

export function inspectHeat(map, lng, lat, period) {
  return inspectPixel(map, lng, lat, 'heat', period)
}

export function inspectForest(map, lng, lat, year) {
  return inspectPixel(map, lng, lat, 'forest', year)
}