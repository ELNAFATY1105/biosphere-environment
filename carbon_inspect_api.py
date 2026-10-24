from datetime import datetime, timezone
import logging
import math

import ee
from fastapi import (
    APIRouter, HTTPException, Path, Query, Request, Response
)
from heat_api import prepare_temperature

router = APIRouter()

CARBON_DATASET = "NASA/ORNL/biomass_carbon_density/v1"
HEAT_DATASET = "MODIS/061/MOD11A1"
FOREST_DATASET = "UMD/hansen/global_forest_change_2025_v1_13"
BOUNDARY = "FAO/GAUL/2025/level1: Nigeria / Gombe"


def valid_number(value):
    return (
        isinstance(value, (int, float))
        and math.isfinite(value)
    )


def base_result(module, lat, lon):
    return {
        "status": "outside_region",
        "module": module,
        "latitude": lat,
        "longitude": lon,
        "boundary": BOUNDARY,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/inspect/carbon")
def inspect_carbon(
    request: Request,
    response: Response,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    response.headers["Cache-Control"] = "no-store"

    try:
        gombe = request.app.state.gombe
        point = ee.Geometry.Point([lon, lat])

        result = base_result("carbon", lat, lon)
        result.update({
            "year": 2010,
            "unit": "t C/ha",
            "aboveground_tC_ha": None,
            "belowground_tC_ha": None,
            "total_tC_ha": None,
            "dataset": CARBON_DATASET,
            "resolution": "Approximately 300 m",
            "method": (
                "Native-grid pixel sample; both carbon bands "
                "must be valid and nonnegative. "
                "No extra carbon conversion factor."
            ),
            "note": (
                "Modelled 2010 living-biomass carbon density, "
                "not current stock or a field measurement. "
                "Excludes soil, dead wood and litter."
            ),
        })

        if not gombe.geometry().contains(point, 10).getInfo():
            return result

        image = ee.Image(
            ee.ImageCollection(CARBON_DATASET).first()
        )
        above = image.select("agb")
        below = image.select("bgb")

        valid = (
            above.mask().And(below.mask())
            .And(above.gte(0))
            .And(below.gte(0))
        )

        sample = (
            above.rename("aboveground_tC_ha")
            .addBands(below.rename("belowground_tC_ha"))
            .updateMask(valid)
            .reduceRegion(
                reducer=ee.Reducer.first(),
                geometry=point,
                crs=above.projection(),
                maxPixels=10000,
            )
            .getInfo()
        )

        a = sample.get("aboveground_tC_ha")
        b = sample.get("belowground_tC_ha")

        if not all(valid_number(v) and v >= 0 for v in (a, b)):
            result["status"] = "no_data"
            return result

        result.update(
            status="ready",
            aboveground_tC_ha=a,
            belowground_tC_ha=b,
            total_tC_ha=a + b,
        )
        return result

    except Exception:
        logging.getLogger(__name__).exception(
            "Carbon pixel inspection failed"
        )
        raise HTTPException(
            502,
            "Carbon inspection failed. Check the backend terminal.",
        ) from None


@router.get("/api/inspect/heat/{year}/{month}")
def inspect_heat(
    request: Request,
    response: Response,
    year: int = Path(..., ge=2015, le=2025),
    month: int = Path(..., ge=1, le=12),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    response.headers["Cache-Control"] = "no-store"

    try:
        gombe = request.app.state.gombe
        point = ee.Geometry.Point([lon, lat])

        result = base_result("heat", lat, lon)
        result.update({
            "year": year,
            "month": month,
            "period": f"{year}-{month:02d}",
            "unit": "°C",
            "mean_lst_c": None,
            "valid_days": None,
            "available_daily_images": None,
            "dataset": HEAT_DATASET,
            "resolution": "Approximately 1 km",
            "method": (
                "Monthly mean of accepted daytime observations "
                "at the native-grid pixel, using the same "
                "quality filter as the Heat map."
            ),
            "quality_filter": (
                "Mandatory QA=0; data quality=0; emissivity "
                "error flag<=1; LST error flag=0; raw temperature>0."
            ),
            "note": (
                "Surface temperature, not air temperature or an "
                "all-weather average. Cloud gaps are not filled. "
                "Low valid-day counts require caution."
            ),
        })

        if not gombe.geometry().contains(point, 10).getInfo():
            return result

        start = ee.Date.fromYMD(year, month, 1)
        daily = (
            ee.ImageCollection(HEAT_DATASET)
            .filterDate(start, start.advance(1, "month"))
            .filterBounds(gombe.geometry())
        )

        count = daily.size().getInfo()
        result["available_daily_images"] = count

        if count == 0:
            result["status"] = "no_data"
            return result

        projection = (
            ee.Image(daily.first())
            .select("LST_Day_1km")
            .projection()
        )

        clean = daily.map(prepare_temperature)
        monthly = clean.mean().setDefaultProjection(projection)
        observations = clean.count().setDefaultProjection(projection)

        sample = (
            monthly.rename("mean_lst_c")
            .addBands(observations.rename("valid_days"))
            .reduceRegion(
                reducer=ee.Reducer.first(),
                geometry=point,
                crs=projection,
                maxPixels=10000,
            )
            .getInfo()
        )

        temperature = sample.get("mean_lst_c")
        days = sample.get("valid_days")

        if not (
            valid_number(temperature)
            and valid_number(days)
            and 0 < days <= count
        ):
            result["status"] = "no_data"
            return result

        result.update(
            status="ready",
            mean_lst_c=temperature,
            valid_days=int(days),
        )
        return result

    except Exception:
        logging.getLogger(__name__).exception(
            "Heat pixel inspection failed"
        )
        raise HTTPException(
            502,
            "Heat inspection failed. Check the backend terminal.",
        ) from None


@router.get("/api/inspect/forest/{year}")
def inspect_forest(
    request: Request,
    response: Response,
    year: int = Path(..., ge=2015, le=2025),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    response.headers["Cache-Control"] = "no-store"

    try:
        gombe = request.app.state.gombe
        point = ee.Geometry.Point([lon, lat])

        result = base_result("forest", lat, lon)
        result.update({
            "year": year,
            "unit": "loss detection",
            "loss_in_selected_year": None,
            "detected_loss_year": None,
            "tree_cover_2000_percent": None,
            "classification": None,
            "reason": None,
            "dataset": FOREST_DATASET,
            "resolution": "Approximately 30 m",
            "method": (
                "Native-grid sample on mapped land. The loss flag "
                "determines whether loss was detected; lossyear "
                "identifies its year when loss=1. "
                "No additional canopy threshold."
            ),
            "note": (
                "Tree-cover loss is not necessarily deforestation. "
                "No detected loss does not prove current forest "
                "presence. Canopy cover refers to 2000. Recorded "
                "loss year refers to the full 2001–2025 dataset."
            ),
        })

        if not gombe.geometry().contains(point, 10).getInfo():
            return result

        image = ee.Image(FOREST_DATASET)

        sample = (
            image.select([
                "loss",
                "lossyear",
                "treecover2000",
                "datamask",
            ])
            .reduceRegion(
                reducer=ee.Reducer.first(),
                geometry=point,
                crs=image.select("lossyear").projection(),
                maxPixels=10000,
            )
            .getInfo()
        )

        mask = sample.get("datamask")

        if mask != 1:
            result.update(
                status="no_data",
                reason=(
                    "permanent_water"
                    if mask == 2
                    else "no_valid_land_data"
                ),
            )
            return result

        loss = sample.get("loss")
        code = sample.get("lossyear")

        if loss == 0:
            # An explicit no-loss flag remains valid even when
            # the loss-year band is masked.
            loss_year = None

            if code is not None and (
                not valid_number(code) or code != 0
            ):
                result.update(
                    status="no_data",
                    reason="inconsistent_loss_bands",
                )
                return result

        elif loss == 1:
            # A detected loss needs a valid recorded year.
            if not (
                valid_number(code)
                and code == int(code)
                and 1 <= code <= 25
            ):
                result.update(
                    status="no_data",
                    reason="missing_loss_year",
                )
                return result

            loss_year = 2000 + int(code)

        else:
            result.update(
                status="no_data",
                reason="missing_loss_flag",
            )
            return result

        cover = sample.get("treecover2000")
        if not (valid_number(cover) and 0 <= cover <= 100):
            cover = None

        detected = loss_year == year

        result.update(
            status="ready",
            loss_in_selected_year=detected,
            detected_loss_year=loss_year,
            tree_cover_2000_percent=cover,
            classification=(
                "Loss detected in selected year"
                if detected
                else "No loss detected in selected year"
            ),
        )
        return result

    except Exception:
        logging.getLogger(__name__).exception(
            "Forest pixel inspection failed"
        )
        raise HTTPException(
            502,
            "Forest inspection failed. Check the backend terminal.",
        ) from None