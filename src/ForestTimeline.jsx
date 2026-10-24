
export default function ForestTimeline({ year, onYearChange }) {
  return (
    <section className="map-timeline" aria-label="Annual tree-cover-loss timeline">
      <div className="timeline-heading">
        <div>
          <h3>Annual tree-cover loss</h3>
          <p>Hansen Global Forest Change · Earth Engine</p>
        </div>
        <div className="timeline-selected">
          <strong>{year}</strong>
          <small>Selected observation year</small>
        </div>
      </div>

      <div className="timeline-controls">
        <button
          aria-label="Previous year"
          disabled={year <= 2015}
          onClick={() => onYearChange(year - 1)}
        >‹</button>

        <div className="timeline-track">
          <input
            type="range"
            aria-label="Forest map year"
            aria-valuetext={`${year}, detected annual tree-cover loss`}
            min="2015"
            max="2025"
            step="1"
            value={year}
            onChange={event => onYearChange(Number(event.target.value))}
          />
          <div className="timeline-ticks">
            <span>2015</span><span>2020</span><span>2025</span>
          </div>
        </div>

        <button
          aria-label="Next year"
          disabled={year >= 2025}
          onClick={() => onYearChange(year + 1)}
        >›</button>
      </div>

      <p className="timeline-disclaimer">
        Red: loss detected in this year only. Not total forest cover or regrowth.
        Basemap imagery dates do not follow the slider.
        The forest KPI and annual chart follow this year. Other modules remain illustrative.
      </p>
    </section>
  )
}
