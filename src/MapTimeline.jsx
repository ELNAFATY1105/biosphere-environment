import { useEffect, useState } from 'react'
import ForestTimeline from './ForestTimeline.jsx'
import { TIMELINE_YEARS, demoMean } from './timelineData.js'

export default function MapTimeline(props) {
  return props.module === 'forest' ? <ForestTimeline {...props} /> : <DemoTimeline {...props} />
}

function DemoTimeline({ module, year, onYearChange }) {
  const [playing, setPlaying] = useState(false)
  const first = TIMELINE_YEARS[0]
  const last = TIMELINE_YEARS.at(-1)
  useEffect(() => {
    if (!playing) return
    if (year >= last) return
    const timer = setTimeout(() => {
      onYearChange(year + 1)
      if (year + 1 >= last) setPlaying(false)
    }, 1200)
    return () => clearTimeout(timer)
  }, [playing, year, last, onYearChange])
  function change(next) { setPlaying(false); onYearChange(next) }
  return <section className="map-timeline" aria-label={`${module === 'forest' ? 'Forest cover change' : 'Drought'} map timeline`}>
    <div className="timeline-heading"><div><h3>{module === 'forest' ? 'Forest cover change' : 'Drought evolution'}</h3><p>Synthetic map preview · Annual steps</p></div><div className="timeline-selected"><strong>{year}</strong><small>{demoMean(module, year)}{module === 'forest' ? '% mean cover' : ' mean SVDI'} · demo</small></div></div>
    <div className="timeline-controls"><button aria-label={playing ? 'Pause timeline' : 'Play timeline'} onClick={() => { if (playing) setPlaying(false); else { if (year >= last) onYearChange(first); setPlaying(true) } }}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button><button aria-label="Previous year" disabled={year === first} onClick={() => change(year - 1)}>‹</button><div className="timeline-track"><input type="range" aria-label={`${module === 'forest' ? 'Forest' : 'Drought'} map year`} aria-valuetext={`${year}, synthetic demonstration`} min={first} max={last} step="1" value={year} onChange={(e) => change(Number(e.target.value))} /><div className="timeline-ticks"><span>{first}</span><span>2020</span><span>{last}</span></div></div><button aria-label="Next year" disabled={year === last} onClick={() => change(year + 1)}>›</button></div>
    <p className="timeline-disclaimer">Years change synthetic grid colours only. These are not observed conditions; basemap imagery dates do not change.</p>
  </section>
}
