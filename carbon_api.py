from datetime import datetime, timezone
from threading import Lock
from time import monotonic
import logging

import ee
from fastapi import APIRouter, HTTPException, Response

router = APIRouter()
DATASET = "NASA/ORNL/biomass_carbon_density/v1"
PALETTE = ["ffffcc", "c2e699", "78c679", "31a354", "006837"]
_cache = None
_lock = Lock()


@router.get("/api/carbon/2010")
def carbon_2010(response: Response, refresh: bool = False):
    global _cache
    response.headers["Cache-Control"] = "no-store"

    with _lock:
        if _cache and not refresh and monotonic() - _cache[0] < 1200:
            return _cache[1]

        try:
            gombe = (
                ee.FeatureCollection("FAO/GAUL/2025/level1")
                .filter(ee.Filter.eq("ISO3_CODE", "NGA"))
                .filter(ee.Filter.eq("GAUL1_NAME", "Gombe"))
            )

            image = ee.Image(ee.ImageCollection(DATASET).first())
            above = image.select("agb")
            below = image.select("bgb")
            grid = above.projection()

            valid = (
                above.mask().And(below.mask())
                .And(above.gte(0))
                .And(below.gte(0))
            )

            above = above.updateMask(valid)
            below = below.updateMask(valid)
            density = above.add(below).rename("carbon_t_ha")
            area = ee.Image.pixelArea().divide(10000)

            sums = (
                above.multiply(area).rename("aboveground_tC")
                .addBands(
                    below.multiply(area).rename("belowground_tC")
                )
                .addBands(
                    density.multiply(area).rename("total_tC")
                )
                .addBands(
                    area.updateMask(valid).rename("valid_ha")
                )
                .addBands(area.rename("region_ha"))
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=gombe.geometry(),
                    crs=grid,
                    maxPixels=100000000,
                    tileScale=4,
                )
                .getInfo()
            )

            region = float(sums.get("region_ha") or 0)
            valid_ha = float(sums.get("valid_ha") or 0)

            if region <= 0:
                raise ValueError("Analysis boundary has no area.")

            has_data = valid_ha > 0
            total = float(sums["total_tC"]) if has_data else None

            legend = {
                "min": 0,
                "max": 50,
                "palette": PALETTE,
                "unit": "t C/ha",
            }

            tile_url = None
            if has_data:
                map_id = density.clipToCollection(gombe).getMapId({
                    "min": 0,
                    "max": 50,
                    "palette": PALETTE,
                })
                tile_url = map_id["tile_fetcher"].url_format

            result = {
                "status": "ready" if has_data else "no_data",
                "year": 2010,
                "region": "Gombe State, Nigeria",
                "metric": "Living-biomass carbon stock",
                "unit": "t C",
                "aboveground_tC": (
                    float(sums["aboveground_tC"]) if has_data else None
                ),
                "belowground_tC": (
                    float(sums["belowground_tC"]) if has_data else None
                ),
                "total_tC": total,
                "total_MtC": (
                    total / 1000000 if has_data else None
                ),
                "mean_density_tC_ha": (
                    total / valid_ha if has_data else None
                ),
                "valid_area_percent": 100 * valid_ha / region,
                "valid_area_ha": valid_ha,
                "tileUrl": tile_url,
                "tileSize": 256,
                "legend": legend,
                "dataset": DATASET,
                "resolution": "Approximately 300 m",
                "boundary": "FAO/GAUL/2025/level1: Nigeria / Gombe",
                "attribution": (
                    "NASA/ORNL biomass carbon density v1; FAO GAUL 2025"
                ),
                "method": (
                    "Aboveground plus belowground carbon density "
                    "multiplied by pixel area on the native grid. "
                    "Both bands must be valid and nonnegative. "
                    "No additional carbon conversion factor."
                ),
                "note": (
                    "Historical 2010 living-biomass carbon estimate. "
                    "Excludes soil, dead wood and litter. "
                    "Not current stock, emissions or sequestration rate. "
                    "Totals cover valid pixels only; missing pixels "
                    "are not zero."
                ),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

            _cache = (monotonic(), result)
            return result

        except Exception:
            logging.getLogger(__name__).exception(
                "Carbon API calculation failed"
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Earth Engine could not prepare the carbon layer. "
                    "Check the Python terminal for details and retry."
                ),
            ) from None
