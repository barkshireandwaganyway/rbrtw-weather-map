#!/usr/bin/env python3
"""
render_mrms.py — Download and render MRMS dual-polarization products.

Products rendered (all from NOAA mrms.ncep.noaa.gov):
  cc_latest.png        Correlation Coefficient  (0.50° tilt)
  zdr_latest.png       Differential Reflectivity (0.50° tilt)
  refl_latest.png      MRMS Composite Reflectivity
  echo_tops_latest.png MRMS Echo Tops (18 dBZ)

Each PNG is uploaded to Cloudflare R2 under the `mrms/` prefix.
The app.js reads from: {R2_PUBLIC_URL}/mrms/{filename}

Run schedule: every 15 minutes via GitHub Actions.
MRMS updates every 2 minutes; 15-minute cadence is a practical balance
between freshness and GitHub Actions free-tier usage.
"""

import gzip
import io
import logging
import sys

import numpy as np
import requests

from common import (
    cc_cmap, zdr_cmap, radar_cmap, echo_tops_cmap,
    read_grib2_bytes, regrid_to_conus, render_field,
    upload, upload_json, now_utc_iso,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('render_mrms')

MRMS_BASE = 'https://mrms.ncep.noaa.gov/data/2D'

# ---------------------------------------------------------------------------
# Product definitions
# ---------------------------------------------------------------------------
# Each entry:
#   subpath  — URL path component after MRMS_BASE
#   key      — R2 upload key (mrms/{filename})
#   cmap_fn  — function returning (cmap, norm, (vmin, vmax))
#   fill_val — MRMS fill value to mask (varies by product)
#   scale    — multiply raw values by this before rendering (e.g. m→ft)
# ---------------------------------------------------------------------------
PRODUCTS = [
    {
        'name': 'Correlation Coefficient',
        'subpath': 'CorrelationCoefficient/MRMS_CorrelationCoefficient_00.50_latest.grib2.gz',
        'key': 'mrms/cc_latest.png',
        'cmap_fn': cc_cmap,
        'fill_val': -999.0,
        'min_valid': 0.2,    # mask CC < 0.2 (no echo)
    },
    {
        'name': 'Differential Reflectivity',
        'subpath': 'DifferentialReflectivity/MRMS_DifferentialReflectivity_00.50_latest.grib2.gz',
        'key': 'mrms/zdr_latest.png',
        'cmap_fn': zdr_cmap,
        'fill_val': -999.0,
    },
    {
        'name': 'MRMS Composite Reflectivity',
        'subpath': 'MergedReflectivityQCComposite/MRMS_MergedReflectivityQCComposite_00.50_latest.grib2.gz',
        'key': 'mrms/refl_latest.png',
        'cmap_fn': radar_cmap,
        'fill_val': -999.0,
        'min_valid': 5.0,    # mask below 5 dBZ (noise)
    },
    {
        'name': 'Echo Tops 18 dBZ',
        'subpath': 'EchoTop18/MRMS_EchoTop18_00.00_latest.grib2.gz',
        'key': 'mrms/echo_tops_latest.png',
        'cmap_fn': echo_tops_cmap,
        'fill_val': -999.0,
        'scale': 3.28084,    # metres → feet
        'min_valid': 1000,   # mask below 1000 ft
    },
]


def download_and_decompress(subpath: str) -> bytes:
    url = f'{MRMS_BASE}/{subpath}'
    log.info(f'GET {url}')
    resp = requests.get(url, timeout=60, headers={'User-Agent': 'RBRTW-Weather-Map/1.0'})
    resp.raise_for_status()
    with gzip.open(io.BytesIO(resp.content)) as gz:
        return gz.read()


def process_product(p: dict) -> dict:
    name = p['name']
    log.info(f'--- {name} ---')
    try:
        raw = download_and_decompress(p['subpath'])
        values, lats, lons, attrs = read_grib2_bytes(raw)

        # Apply scale factor (e.g. metres → feet for echo tops)
        if p.get('scale'):
            values = values * p['scale']

        # Mask fill values and optional minimum threshold
        values = np.where(np.isclose(values, p.get('fill_val', -999.0), atol=1), np.nan, values)
        if p.get('min_valid') is not None:
            values = np.where(values < p['min_valid'], np.nan, values)

        # Regrid to regular CONUS lat-lon grid
        gridded = regrid_to_conus(values, lats, lons)

        # Get color map
        cmap, norm, (vmin, vmax) = p['cmap_fn']()

        # Render to transparent PNG
        png = render_field(gridded, cmap, norm, vmin, vmax, alpha=0.88)

        upload(png, p['key'])
        log.info(f'OK: {p["key"]} ({len(png):,} bytes)')
        return {'product': name, 'key': p['key'], 'ok': True}

    except Exception as e:
        log.error(f'FAILED {name}: {e}', exc_info=True)
        return {'product': name, 'ok': False, 'error': str(e)}


if __name__ == '__main__':
    results = [process_product(p) for p in PRODUCTS]

    # Write a metadata JSON so the map can display update timestamps
    ok_keys = [r['key'] for r in results if r['ok']]
    upload_json({
        'updated_utc': now_utc_iso(),
        'products': ok_keys,
        'bounds': {'west': -130, 'east': -60, 'south': 20, 'north': 55},
    }, 'mrms/metadata.json')

    failed = [r for r in results if not r['ok']]
    if failed:
        log.error(f'Failed: {[r["product"] for r in failed]}')
        sys.exit(1)

    log.info('All MRMS products complete.')
