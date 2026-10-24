// Synthetic demonstration cells, NOT measured conditions or administrative areas.
export const TIMELINE_YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i)
export function demoCells(module, year) {
  const t = year - 2015
  const features = []
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const west = 11.11 + col * 0.025
      const south = 10.19 + row * 0.025
      const value = module === 'forest'
        ? Math.max(0, Math.min(100, 83 - col * 4 - row * 2 - t * (0.7 + ((row + col) % 3) * 0.25)))
        : Math.max(-2, Math.min(2, 0.65 * Math.sin((row + col) * 0.65 + t * 0.48) + 0.45 - t * 0.13))
      features.push({ type: 'Feature', properties: { value: Number(value.toFixed(2)), year, module, status: 'SYNTHETIC DEMO' }, geometry: { type: 'Polygon', coordinates: [[[west, south], [west + 0.025, south], [west + 0.025, south + 0.025], [west, south + 0.025], [west, south]]] } })
    }
  }
  return { type: 'FeatureCollection', features }
}
export function demoMean(module, year) {
  const cells = demoCells(module, year).features
  return Number((cells.reduce((sum, cell) => sum + cell.properties.value, 0) / cells.length).toFixed(module === 'forest' ? 1 : 2))
}

export function demoImage(module, year) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  const stops = module === 'forest'
    ? [[232, 220, 180], [112, 181, 129], [21, 90, 59]]
    : [[215, 103, 67], [238, 227, 187], [93, 155, 164]]
  demoCells(module, year).features.forEach((cell, i) => {
    const value = cell.properties.value
    const fraction = module === 'forest' ? value / 100 : (value + 2) / 4
    const segment = fraction < 0.5 ? 0 : 1
    const weight = fraction < 0.5 ? fraction * 2 : (fraction - 0.5) * 2
    const rgb = stops[segment].map((v, channel) => Math.round(v + (stops[segment + 1][channel] - v) * weight))
    const x = (i % 8) * 64
    const y = (7 - Math.floor(i / 8)) * 64
    context.fillStyle = `rgb(${rgb.join(',')})`
    context.fillRect(x, y, 64, 64)
    context.strokeStyle = 'rgba(245,250,245,0.25)'
    context.strokeRect(x + 0.5, y + 0.5, 63, 63)
  })
  return { url: canvas.toDataURL('image/png'), coordinates: [[11.11, 10.39], [11.31, 10.39], [11.31, 10.19], [11.11, 10.19]] }
}
