from datetime import datetime, timezone
from threading import Lock
from time import monotonic
import logging
import math

import ee
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

router = APIRouter()

DATASET = "MODIS/061/MOD11A1"
STATE_BOUNDARY = "FAO/GAUL/2025/level1"
LGA_BOUNDARY = "FAO/GAUL/2025/level2"

PALETTE = [
    "2166ac", "67a9cf", "d1e5f0", "ffffbf",
    "fdae61", "f46d43", "a50026",
]

cache = {}
lock = Lock()
catalog_cache = {}
catalog_lock = Lock()
logger = logging.getLogger(__name__)


def prepare_temperature(image):
    quality = image.select("QC_Day")
    raw = image.select("LST_Day_1km")

    keep = (
        quality.bitwiseAnd(3).eq(0)
        .And(quality.rightShift(2).bitwiseAnd(3).eq(0))
        .And(quality.rightShift(4).bitwiseAnd(3).lte(1))
        .And(quality.rightShift(6).bitwiseAnd(3).eq(0))
        .And(raw.gt(0))
    )

    return (
        raw.multiply(0.02)
        .subtract(273.15)
        .updateMask(keep)
        .rename("LST_C")
    )


def summarize(sums):
    region = float(sums["region_m2"])
    valid = float(sums.get("valid_m2") or 0)

    if not math.isfinite(region) or region <= 0:
        raise ValueError("Invalid analysis area.")

    if not math.isfinite(valid) or valid < 0:
        raise ValueError("Invalid valid-pixel area.")

    return {
        "mean_lst_c": (
            float(sums["temperature_area"]) / valid
            if valid > 0 else None
        ),
        "valid_area_percent": 100 * valid / region,
        "mean_valid_days": (
            float(sums["observation_area"]) / valid
            if valid > 0 else None
        ),
    }


def lga_collection():
    return (
        ee.FeatureCollection(LGA_BOUNDARY)
        .filter(ee.Filter.eq("ISO3_CODE", "NGA"))
        .filter(ee.Filter.eq("GAUL1_NAME", "Gombe"))
    )


def get_region_catalog(request):
    with catalog_lock:
        saved = catalog_cache.get("gombe")

        if saved and monotonic() - saved[0] < 21600:
            return saved[1]

        state = request.app.state.gombe
        lgas = lga_collection()

        counts = ee.Dictionary({
            "state": state.size(),
            "lgas": lgas.size(),
        }).getInfo()

        if counts["state"] != 1 or counts["lgas"] < 1:
            raise ValueError("Unexpected state or LGA boundary count.")

        pairs = lgas.reduceColumns(
            reducer=ee.Reducer.toList(2),
            selectors=["GAUL2_CODE", "GAUL2_NAME"],
        ).get("list").getInfo()

        areas = []
        codes = set()

        for code, name in pairs:
            if (
                not isinstance(code, (int, float))
                or not math.isfinite(code)
                or int(code) != code
                or not isinstance(name, str)
                or not name.strip()
            ):
                raise ValueError("Invalid LGA name or code.")

            code = int(code)

            if code in codes:
                raise ValueError("Duplicate LGA codes in boundary dataset.")

            codes.add(code)
            areas.append({
                "lga_code": code,
                "name": name.strip(),
            })

        if len(areas) != counts["lgas"]:
            raise ValueError("Some LGA records are missing names or codes.")

        areas.sort(key=lambda area: area["name"].casefold())

        state_geometry = state.geometry()
        union = lgas.geometry()
        tolerance = 10

        summed_areas = lgas.map(
            lambda feature: feature.set(
                "checked_area_m2",
                feature.geometry().area(tolerance),
            )
        ).aggregate_sum("checked_area_m2")

        coverage = ee.Dictionary({
            "state_area_km2":
                state_geometry.area(tolerance).divide(1e6),

            "lga_union_area_km2":
                union.area(tolerance).divide(1e6),

            "state_not_covered_by_lgas_km2":
                state_geometry
                .difference(union, tolerance)
                .area(tolerance)
                .divide(1e6),

            "lga_area_outside_state_km2":
                union
                .difference(state_geometry, tolerance)
                .area(tolerance)
                .divide(1e6),

            "summed_lga_area_minus_union_km2":
                ee.Number(summed_areas)
                .subtract(union.area(tolerance))
                .divide(1e6),
        }).getInfo()

        result = {
            "status": "ready",
            "region": "Gombe State, Nigeria",
            "default": {
                "lga_code": None,
                "name": "All Gombe State",
            },
            "lga_count": len(areas),
            "lgas": areas,
            "boundary": LGA_BOUNDARY,
            "state_boundary": STATE_BOUNDARY,
            "coverage_check": coverage,
            "geometry_tolerance_metres": tolerance,
            "boundary_policy": (
                "Use each GAUL 2025 LGA geometry as supplied, without clipping "
                "it to the state geometry. Statewide results retain the "
                "level-1 state boundary. Coverage differences are reported; "
                "LGA totals are not assumed to sum exactly to statewide totals."
            ),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

        catalog_cache["gombe"] = (monotonic(), result)
        return result


@router.get("/api/regions")
def regions(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"

    try:
        return get_region_catalog(request)

    except Exception:
        logger.exception("LGA boundary check failed")

        raise HTTPException(
            502,
            "Could not check LGA boundaries. Statewide Heat remains available.",
        ) from None


def resolve_region(request, lga_code):
    if lga_code is None:
        return request.app.state.gombe, {
            "region": "Gombe State, Nigeria",
            "region_type": "state",
            "lga_code": None,
            "boundary": f"{STATE_BOUNDARY}: Nigeria / Gombe",
        }

    catalog = get_region_catalog(request)

    area = next(
        (
            item for item in catalog["lgas"]
            if item["lga_code"] == lga_code
        ),
        None,
    )

    if area is None:
        raise HTTPException(
            404,
            "This LGA code is not in Gombe State.",
        )

    selected = lga_collection().filter(
        ee.Filter.eq("GAUL2_CODE", lga_code)
    )

    return selected, {
        "region": f"{area['name']} LGA, Gombe State, Nigeria",
        "region_type": "lga",
        "lga_code": lga_code,
        "lga_name": area["name"],
        "boundary": (
            f"{LGA_BOUNDARY}: Nigeria / Gombe / {area['name']}"
        ),
        "boundary_policy": catalog["boundary_policy"],
    }


@router.get("/api/heat/{year}/{month}")
def heat_layer(
    request: Request,
    response: Response,
    year: int = Path(ge=2015, le=2025),
    month: int = Path(ge=1, le=12),
    refresh: bool = False,
    lga_code: int | None = Query(default=None),
):
    response.headers["Cache-Control"] = "no-store"

    # Keep statewide and individual LGA results separate.
    key = (year, month, lga_code)

    with lock:
        saved = cache.get(key)

        if (
            saved
            and not refresh
            and monotonic() - saved[0] < 1800
        ):
            return saved[1]

        try:
            region, region_info = resolve_region(request, lga_code)
            start = ee.Date.fromYMD(year, month, 1)

            daily = (
                ee.ImageCollection(DATASET)
                .filterDate(start, start.advance(1, "month"))
                .filterBounds(region.geometry())
            )

            count = daily.size().getInfo()

            if count == 0:
                raise HTTPException(
                    404,
                    "No source images available for this month.",
                )

            projection = (
                ee.Image(daily.first())
                .select("LST_Day_1km")
                .projection()
            )

            grid = projection.getInfo()

            clean = daily.map(prepare_temperature)
            monthly = clean.mean().setDefaultProjection(projection)
            observations = clean.count().setDefaultProjection(projection)

            area = ee.Image.pixelArea()
            valid_area = area.updateMask(monthly.mask())

            sums = (
                monthly.multiply(area)
                .rename("temperature_area")
                .addBands(valid_area.rename("valid_m2"))
                .addBands(area.rename("region_m2"))
                .addBands(
                    observations.multiply(valid_area)
                    .rename("observation_area")
                )
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=region.geometry(),
                    crs=grid["crs"],
                    crsTransform=grid["transform"],
                    maxPixels=1e8,
                    tileScale=4,
                )
                .getInfo()
            )

            summary = summarize(sums)
            tile_url = None

            if summary["mean_lst_c"] is not None:
                map_info = monthly.clipToCollection(region).getMapId({
                    "min": 20,
                    "max": 60,
                    "palette": PALETTE,
                })
                tile_url = map_info["tile_fetcher"].url_format

            result = {
                "status": "ready" if tile_url else "no_data",
                "year": year,
                "month": month,
                "period": f"{year}-{month:02d}",
                **region_info,
                "metric": "Monthly mean daytime land surface temperature",
                "unit": "°C",
                **summary,
                "available_daily_images": count,
                "tileUrl": tile_url,
                "tileSize": 256,
                "legend": {
                    "min": 20,
                    "max": 60,
                    "palette": PALETTE,
                },
                "dataset": DATASET,
                "resolution": "Approximately 1 km",
                "attribution": (
                    "NASA MOD11A1.061; boundary: FAO GAUL 2025"
                ),
                "method": (
                    "Per-pixel mean of quality-filtered daytime observations, "
                    "then area-weighted mean over valid pixels in the selected "
                    "area on the native MODIS grid."
                ),
                "quality_filter": (
                    "Mandatory QA=0; data quality=0; emissivity error flag<=1; "
                    "LST error flag=0; raw temperature>0."
                ),
                "coverage_note": (
                    "Valid-area percentage means at least one accepted observation "
                    "during the month. Mean valid days is area-weighted over those "
                    "pixels. Low observation counts require caution."
                ),
                "note": (
                    "Surface temperature, not air temperature or an all-weather "
                    "monthly average. Display colours are not heat-risk classes. "
                    "Cloud gaps are not filled."
                ),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

            if len(cache) >= 72 and key not in cache:
                cache.pop(next(iter(cache)))

            cache[key] = (monotonic(), result)
            return result

        except HTTPException:
            raise

        except Exception:
            logger.exception("Heat API failed")

            raise HTTPException(
                502,
                "Earth Engine could not prepare the heat layer. "
                "Retry; if it persists, share the backend terminal error.",
            ) from None