import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import ee
from fastapi import FastAPI, HTTPException, Path, Response
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ID = os.environ.get("EE_PROJECT_ID", "coral-core-430522-f4")
DATASET_ID = "UMD/hansen/global_forest_change_2025_v1_13"
YEARS = list(range(2015, 2026))

map_cache = {}
stats_cache = {}
map_lock = Lock()
stats_lock = Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from earth_engine_auth import initialize_earth_engine
    initialize_earth_engine(PROJECT_ID)

    gombe = (
        ee.FeatureCollection("FAO/GAUL/2025/level1")
        .filter(ee.Filter.eq("ISO3_CODE", "NGA"))
        .filter(ee.Filter.eq("GAUL1_NAME", "Gombe"))
    )

    if gombe.size().getInfo() == 0:
        raise RuntimeError("Gombe boundary was not found.")

    app.state.gombe = gombe
    app.state.forest = ee.Image(DATASET_ID)

    print("Earth Engine backend ready: maps and annual statistics.")
    yield

    map_cache.clear()
    stats_cache.clear()


app = FastAPI(
    title="BIOSPHERECONSULT Earth Engine API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET"],
    allow_headers=["Accept", "Content-Type"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ready",
        "service": "BIOSPHERECONSULT Earth Engine API",
    }


def annual_rows(groups):
    if not isinstance(groups, list):
        raise ValueError(
            "Earth Engine did not return grouped statistics."
        )

    by_year = {
        int(item["loss_code"]) + 2000: float(item["sum"])
        for item in groups
    }

    return [
        {"year": year, "loss_ha": by_year.get(year, 0.0)}
        for year in YEARS
    ]


# Keep this route ABOVE /api/forest/{year}.
@app.get("/api/forest/stats")
def forest_stats(response: Response):
    response.headers["Cache-Control"] = "no-store"

    with stats_lock:
        cached = stats_cache.get("annual")

        # Reuse successful calculations for six hours.
        if cached and monotonic() - cached[0] < 21600:
            return cached[1]

        try:
            loss_year = app.state.forest.select("lossyear")

            # Codes 15–25 represent 2015–2025.
            selected = loss_year.gte(15).And(loss_year.lte(25))

            # Preserve the original dataset's pixel grid.
            grid = loss_year.projection().getInfo()

            # Convert pixel area from square metres to hectares.
            area_and_year = (
                ee.Image.pixelArea()
                .divide(10000)
                .rename("area_ha")
                .addBands(loss_year.rename("loss_code"))
                .updateMask(selected)
            )

            # Sum hectares, grouped by the recorded loss year.
            grouped = area_and_year.reduceRegion(
                reducer=ee.Reducer.sum().group(
                    groupField=1,
                    groupName="loss_code",
                ),
                geometry=app.state.gombe.geometry(),
                crs=grid["crs"],
                crsTransform=grid["transform"],
                maxPixels=1e9,
                tileScale=4,
            ).getInfo()

            rows = annual_rows(grouped.get("groups"))

            result = {
                "status": "ready",
                "region": "Gombe State, Nigeria",
                "metric": "Annual detected tree-cover loss",
                "unit": "ha",
                "start_year": 2015,
                "end_year": 2025,
                "annual": rows,
                "total_loss_ha": sum(
                    row["loss_ha"] for row in rows
                ),
                "latest_year": 2025,
                "latest_loss_ha": rows[-1]["loss_ha"],
                "dataset": DATASET_ID,
                "boundary": (
                    "FAO/GAUL/2025/level1: Nigeria / Gombe"
                ),
                "method": (
                    "Pixel area summed by loss year on the native "
                    "Hansen grid; no additional canopy threshold."
                ),
                "note": (
                    "Gross detected loss, not net change, remaining "
                    "forest cover or confirmed deforestation. "
                    "Regrowth is not included."
                ),
                "computed_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            }

            stats_cache["annual"] = (monotonic(), result)
            return result

        except Exception as error:
            print(
                "Forest statistics failed:",
                type(error).__name__,
            )

            raise HTTPException(
                status_code=502,
                detail=(
                    "Earth Engine could not calculate forest statistics. "
                    "No zero values have been substituted. "
                    "Check the connection and retry; if it persists, "
                    "share this message and the terminal error type."
                ),
            ) from None


@app.get("/api/forest/{year}")
def forest_layer(
    response: Response,
    year: int = Path(ge=2015, le=2025),
    refresh: bool = False,
):
    response.headers["Cache-Control"] = "no-store"

    with map_lock:
        cached = map_cache.get(year)

        if (
            cached
            and not refresh
            and monotonic() - cached[0] < 1800
        ):
            return cached[1]

        try:
            annual_loss = (
                app.state.forest.select("lossyear")
                .eq(year - 2000)
                .selfMask()
                .clipToCollection(app.state.gombe)
            )

            map_info = annual_loss.getMapId({
                "min": 0,
                "max": 1,
                "palette": ["ff4545"],
            })

            result = {
                "status": "ready",
                "year": year,
                "name": f"Detected tree-cover loss — {year}",
                "tileUrl": map_info["tile_fetcher"].url_format,
                "tileSize": 256,
                "dataset": DATASET_ID,
                "attribution": (
                    "Hansen/UMD/Google/USGS/NASA; "
                    "boundary: FAO GAUL 2025"
                ),
                "description": (
                    "Loss detected in the selected year only. "
                    "Not total forest cover or regrowth."
                ),
            }

            map_cache[year] = (monotonic(), result)
            return result

        except Exception as error:
            print(
                "Earth Engine request failed:",
                type(error).__name__,
            )

            raise HTTPException(
                status_code=502,
                detail=(
                    "Earth Engine could not prepare this layer. "
                    "Check your internet connection and retry."
                ),
            ) from None

from heat_api import router as heat_router
app.include_router(heat_router)

from spi_api import router as spi_router
app.include_router(spi_router)


from carbon_api import router as carbon_router
app.include_router(carbon_router)


from flood_api import router as flood_router
app.include_router(flood_router)


from carbon_inspect_api import router as carbon_inspect_router
app.include_router(carbon_inspect_router)


