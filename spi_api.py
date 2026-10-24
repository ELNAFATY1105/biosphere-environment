from datetime import datetime, timezone
from threading import Lock
from time import monotonic
import ee
from fastapi import APIRouter, HTTPException, Path, Request, Response

router = APIRouter()
cache = {}
lock = Lock()

DATASET = 'UCSB-CHG/CHIRPS/DAILY'
PALETTE = [
    '8b0000', 'e34a33', 'fdbb84', 'f0f0f0',
    'a6bddb', '3690c0', '034e7b'
]


@router.get('/api/spi/{year}/{month}')
def spi_layer(
    request: Request,
    response: Response,
    year: int = Path(ge=2015, le=2025),
    month: int = Path(ge=1, le=12),
    refresh: bool = False,
):
    response.headers['Cache-Control'] = 'no-store'
    key = (year, month)

    with lock:
        saved = cache.get(key)
        if saved and not refresh and monotonic() - saved[0] < 1800:
            return saved[1]

        try:
            gombe = request.app.state.gombe
            rain = ee.ImageCollection(DATASET).select('precipitation')
            grid = ee.Image(rain.first()).projection()

            end = ee.Date.fromYMD(year, month, 1).advance(1, 'month')
            start = end.advance(-3, 'month')
            daily = rain.filterDate(start, end)

            completeness = ee.Dictionary({
                'actual': daily.size(),
                'expected': end.difference(start, 'day')
            }).getInfo()

            if completeness['actual'] != completeness['expected']:
                raise HTTPException(
                    404,
                    'The selected three-month window is incomplete in CHIRPS v2 Final.'
                )

            def total(y):
                finish = ee.Date.fromYMD(
                    ee.Number(y).toInt(), month, 1
                ).advance(1, 'month')
                begin = finish.advance(-3, 'month')
                images = rain.filterDate(begin, finish)

                return (
                    images.sum()
                    .setDefaultProjection(grid)
                    .updateMask(
                        images.count().eq(finish.difference(begin, 'day'))
                    )
                    .rename('P')
                )

            baseline = ee.ImageCollection.fromImages(
                ee.List.sequence(1991, 2020).map(total)
            )

            observed = total(year)
            n = baseline.count()

            positive = baseline.map(
                lambda image: image.updateMask(image.gt(0))
            )
            np = positive.count()
            mean = positive.mean()
            a = mean.log().subtract(
                positive.map(lambda image: image.log()).mean()
            )

            good = n.eq(30).And(np.gte(20)).And(a.gt(1e-8))
            safe = a.updateMask(good)

            alpha = (
                safe.multiply(4 / 3).add(1).sqrt().add(1)
                .divide(safe.multiply(4))
            )
            beta = mean.divide(alpha)
            q = n.subtract(np).divide(n)

            probability = q.add(
                ee.Image.constant(1).subtract(q).multiply(
                    observed.divide(beta).gammainc(alpha)
                )
            )

            spi = (
                probability.clamp(1e-6, 1 - 1e-6)
                .multiply(2).subtract(1)
                .erfInv().multiply(2 ** 0.5)
                .updateMask(good)
                .rename('SPI3')
                .setDefaultProjection(grid)
            )

            classes = (
                spi.multiply(0).add(3)
                .where(spi.lte(-2), 0)
                .where(spi.gt(-2).And(spi.lte(-1.5)), 1)
                .where(spi.gt(-1.5).And(spi.lte(-1)), 2)
                .where(spi.gte(1).And(spi.lt(1.5)), 4)
                .where(spi.gte(1.5).And(spi.lt(2)), 5)
                .where(spi.gte(2), 6)
            )

            area = ee.Image.pixelArea()
            valid = area.updateMask(spi.mask())

            sums = (
                spi.multiply(area).rename('spi_area')
                .addBands(valid.rename('valid_area'))
                .addBands(area.rename('region_area'))
                .addBands(
                    valid.multiply(spi.lte(-1)).rename('dry_area')
                )
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=gombe.geometry(),
                    crs=grid,
                    maxPixels=1e7,
                    tileScale=4
                )
                .getInfo()
            )

            valid_m2 = float(sums.get('valid_area') or 0)
            region_m2 = float(sums.get('region_area') or 0)

            if region_m2 <= 0:
                raise ValueError('Invalid region area')

            tile_url = None
            if valid_m2 > 0:
                tile_url = classes.clipToCollection(gombe).getMapId({
                    'min': 0,
                    'max': 6,
                    'palette': PALETTE
                })['tile_fetcher'].url_format

            result = {
                'status': 'ready' if tile_url else 'no_data',
                'year': year,
                'month': month,
                'period': f'{year}-{month:02d}',
                'region': 'Gombe State, Nigeria',
                'metric': 'SPI-3',
                'unit': 'dimensionless',
                'baseline': '1991-2020 (ending years; same three-month window)',
                'mean_spi': (
                    float(sums['spi_area']) / valid_m2
                    if valid_m2 else None
                ),
                'valid_area_percent': 100 * valid_m2 / region_m2,
                'dry_area_percent_of_valid': (
                    100 * float(sums.get('dry_area') or 0) / valid_m2
                    if valid_m2 else None
                ),
                'tileUrl': tile_url,
                'tileSize': 256,
                'palette': PALETTE,
                'classes': [
                    'Extremely dry', 'Severely dry', 'Moderately dry',
                    'Near normal', 'Moderately wet', 'Very wet',
                    'Extremely wet'
                ],
                'dataset': DATASET,
                'resolution': 'Approximately 5.6 km',
                'attribution': 'CHIRPS v2 Final / UCSB CHG; boundary: FAO GAUL 2025',
                'method': (
                    'Per-pixel three-month totals; approximate maximum-likelihood '
                    'gamma fit to positive baseline totals; zero probability '
                    'correction; inverse normal transform.'
                ),
                'quality_rule': (
                    '30 complete baseline windows; at least 20 positive totals; '
                    'nondegenerate fit. Probability clipped to [0.000001,0.999999].'
                ),
                'note': (
                    'Mean SPI is an area-weighted mean of valid pixel SPI, '
                    'not SPI fitted to statewide rainfall. Dry area uses '
                    'SPI <= -1 and valid area as denominator. Missing pixels '
                    'are not near-normal. Research output, not a forecast.'
                ),
                'computed_at': datetime.now(timezone.utc).isoformat()
            }

            if len(cache) >= 24 and key not in cache:
                cache.pop(next(iter(cache)))

            cache[key] = (monotonic(), result)
            return result

        except HTTPException:
            raise

        except Exception as error:
            print('SPI API failed:', type(error).__name__)
            raise HTTPException(
                502,
                'SPI calculation failed. Retry or report the terminal error type.'
            ) from None
