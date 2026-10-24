from datetime import datetime, timezone
from threading import Lock
from time import monotonic
import logging

import ee
from fastapi import APIRouter, HTTPException, Response

router = APIRouter()
DATASET = "JRC/CEMS_GLOFAS/FloodHazard/v2_1"
PERIODS = (10, 20, 50, 75, 100, 200, 500)
PALETTE = ["deebf7", "9ecae1", "4292c6", "08519c", "08306b"]
_cache = {}
_lock = Lock()


@router.get("/api/flood/{return_period}")
def flood_layer(
    return_period: int,
    response: Response,
    refresh: bool = False,
):
    response.headers["Cache-Control"] = "no-store"

    if return_period not in PERIODS:
        raise HTTPException(
            422,
            "Return period must be 10, 20, 50, 75, 100, 200 or 500.",
        )

    with _lock:
        cached = _cache.get(return_period)
        if cached and not refresh and monotonic() - cached[0] < 1200:
            return cached[1]

        try:
            gombe = (
                ee.FeatureCollection("FAO/GAUL/2025/level1")
                .filter(ee.Filter.eq("ISO3_CODE", "NGA"))
                .filter(ee.Filter.eq("GAUL1_NAME", "Gombe"))
            )

            tiles = ee.ImageCollection(DATASET).filterBounds(
                gombe.geometry()
            )

            if tiles.size().getInfo() == 0:
                raise HTTPException(
                    404, "No flood source tiles intersect Gombe."
                )

            band = f"RP{return_period}_depth"
            grid = ee.Image(tiles.first()).select(band).projection()
            image = tiles.mosaic()
            depth = image.select(band)

            permanent = (
                image.select("permanent_water_class").unmask(0).eq(1)
            )
            flagged = (
                image.select("spurious_depth_category").unmask(0).eq(1)
            )

            wet = depth.gt(0)
            keep = wet.And(permanent.Not()).And(flagged.Not())
            eligible = depth.updateMask(keep)
            area = ee.Image.pixelArea().divide(10000)

            sums = (
                area.updateMask(keep)
                .rename("mapped_inundation_ha")
                .addBands(
                    area.updateMask(
                        wet.And(permanent.Not()).And(flagged)
                    ).rename("excluded_flagged_nonpermanent_ha")
                )
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=gombe.geometry(),
                    crs=grid,
                    maxPixels=100000000,
                    tileScale=4,
                )
                .getInfo()
            )

            raw_area = sums.get("mapped_inundation_ha")
            mapped_area = (
                float(raw_area) if raw_area is not None else None
            )
            has_pixels = mapped_area is not None and mapped_area > 0

            tile_url = None
            if has_pixels:
                map_id = eligible.clipToCollection(gombe).getMapId({
                    "min": 0,
                    "max": 5,
                    "palette": PALETTE,
                })
                tile_url = map_id["tile_fetcher"].url_format

            result = {
                "status": "ready" if has_pixels else "no_data",
                "region": "Gombe State, Nigeria",
                "metric": "Mapped river flood inundation area",
                "unit": "ha",
                "return_period_years": return_period,
                "annual_exceedance_probability_percent": (
                    100 / return_period
                ),
                "available_return_periods": list(PERIODS),
                "mapped_inundation_ha": mapped_area,
                "excluded_flagged_nonpermanent_ha": float(
                    sums.get("excluded_flagged_nonpermanent_ha") or 0
                ),
                "tileUrl": tile_url,
                "tileSize": 256,
                "legend": {
                    "min": 0,
                    "max": 5,
                    "palette": PALETTE,
                    "unit": "m",
                },
                "dataset": DATASET,
                "resolution": "Approximately 90 m",
                "boundary": "FAO/GAUL/2025/level1: Nigeria / Gombe",
                "attribution": (
                    "European Commission JRC / CEMS; FAO GAUL 2025"
                ),
                "method": (
                    "Positive modelled depth; permanent water and "
                    "spurious-depth flags excluded. Area summed on "
                    "the source grid. No zero-filling of missing "
                    "depth pixels."
                ),
                "note": (
                    "Modelled river flood hazard scenario, not an "
                    "observed event, forecast, warning or complete "
                    "risk assessment. Blank areas are not proof of "
                    "safety. Return period is not a calendar year. "
                    "Null mapped area means no retained pixels, not "
                    "confirmed zero hazard. Display colours saturate "
                    "above 5 m; area calculations retain all "
                    "positive depths."
                ),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

            _cache[return_period] = (monotonic(), result)
            return result

        except HTTPException:
            raise
        except Exception:
            logging.getLogger(__name__).exception(
                "Flood API calculation failed"
            )
            raise HTTPException(
                502,
                "Earth Engine could not prepare the flood layer. "
                "Check the Python terminal for details and retry.",
            ) from None
