#!/usr/bin/env python3
"""
render_models.py — Download and render RAP and GFS model fields.

Usage:
  python render_models.py --model rap    # render RAP (hourly)
  python render_models.py --model gfs    # render GFS (every 6 hr)

Products per model:
  RAP  → refl, sfc_temp, dewpoint, cape, cin  (analysis + F01..F03)
  GFS  → cape, mslp, 500mb_hgt              (analysis + F06..F24)

Uses the NOMADS GRIB filter API to request only the variables and
subregion we need — files are typically 1–20 MB, not 500 MB+.

Output PNGs are uploaded to Cloudflare R2 under:
  models/rap/{product}_f{HH}.png
  models/gfs/{product}_f{HH}.png
"""

import argparse
import io
import logging
import sys
from datetime import datetime, timezone, timedelta

import numpy as np
import requests

from common import (
    cape_cmap, temp_cmap, mslp_cmap, radar_cmap,
    read_grib2_bytes, regrid_to_conus, render_field,
    upload, upload_json, now_utc_iso,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('render_models')

NOMADS = 'https://nomads.ncep.noaa.gov'

# ---- Subregion filter (CONUS) ---- passed to NOMADS filter API
SUBREGION = 'subregion=&toplat=55&leftlon=-130&rightlon=-60&bottomlat=20'


# ---------------------------------------------------------------------------
# NOMADS latest-run discovery
# ---------------------------------------------------------------------------

def find_latest_run(model: str) -> tuple[str, str]:
    """
    Return (YYYYMMDD, HH) of the latest available model run on NOMADS.
    Checks the last 24 hours, starting from now.
    """
    now = datetime.now(timezone.utc)
    if model == 'rap':
        cycle_hours = list(range(23, -1, -1))      # RAP runs every hour
        base_dir = lambda d, h: f'/pub/data/nccf/com/rap/prod/rap.{d}/'
        file_check = lambda d, h: f'{NOMADS}/pub/data/nccf/com/rap/prod/rap.{d}/rap.t{h:02d}z.wrfprsf00.grib2'
    elif model == 'gfs':
        cycle_hours = [18, 12, 6, 0]               # GFS runs 4× per day
        file_check = lambda d, h: (
            f'{NOMADS}/pub/data/nccf/com/gfs/prod/gfs.{d}/{h:02d}/atmos/'
            f'gfs.t{h:02d}z.pgrb2.0p25.f000'
        )
    else:
        raise ValueError(f'Unknown model: {model}')

    for day_offset in range(2):                    # search today and yesterday
        date_str = (now - timedelta(days=day_offset)).strftime('%Y%m%d')
        for h in cycle_hours:
            url = file_check(date_str, h)
            try:
                r = requests.head(url, timeout=10,
                                  headers={'User-Agent': 'RBRTW-Weather-Map/1.0'})
                if r.status_code in (200, 302):
                    log.info(f'Latest {model} run: {date_str}/{h:02d}z')
                    return date_str, f'{h:02d}'
            except Exception:
                pass

    raise RuntimeError(f'Could not find a recent {model} run on NOMADS')


# ---------------------------------------------------------------------------
# NOMADS GRIB filter URLs
# ---------------------------------------------------------------------------

def rap_url(date: str, run: str, fhr: int, variables: list[str]) -> str:
    """
    Build a NOMADS GRIB filter URL for RAP.
    variables: list of GRIB variable names e.g. ['REFC', 'TMP', 'DPT']
    """
    file  = f'rap.t{run}z.wrfprsf{fhr:02d}.grib2'
    var_q = ''.join(f'&var_{v}=on' for v in variables)
    return (f'{NOMADS}/cgi-bin/filter_rap.pl'
            f'?dir=%2Frap.{date}&file={file}{var_q}&{SUBREGION}')


def gfs_url(date: str, run: str, fhr: int, variables: list[str],
            levels: list[str] = None) -> str:
    """
    Build a NOMADS GRIB filter URL for GFS 0.25-degree.
    levels: list of level strings e.g. ['lev_surface=on', 'lev_500_mb=on']
    """
    file  = f'gfs.t{run}z.pgrb2.0p25.f{fhr:03d}'
    var_q = ''.join(f'&var_{v}=on' for v in variables)
    lev_q = '&' + '&'.join(levels) if levels else '&lev_surface=on'
    return (f'{NOMADS}/cgi-bin/filter_gfs_0p25.pl'
            f'?dir=%2Fgfs.{date}%2F{run}%2Fatmos&file={file}{var_q}{lev_q}&{SUBREGION}')


# ---------------------------------------------------------------------------
# Download + process a single model field
# ---------------------------------------------------------------------------

def download_grib(url: str, filter_by_keys: dict = None):
    log.info(f'GET {url[:100]}…')
    resp = requests.get(url, timeout=120,
                        headers={'User-Agent': 'RBRTW-Weather-Map/1.0'})
    resp.raise_for_status()
    return read_grib2_bytes(resp.content, filter_by_keys=filter_by_keys)


def c_to_f(arr):
    """Celsius → Fahrenheit."""
    return arr * 9.0 / 5.0 + 32.0


def pa_to_hpa(arr):
    return arr / 100.0


def render_and_upload(values, lats, lons, cmap_fn, key: str,
                      transform_fn=None, alpha=0.85):
    if transform_fn:
        values = transform_fn(values)
    gridded = regrid_to_conus(values, lats, lons)
    cmap, norm, (vmin, vmax) = cmap_fn()
    png = render_field(gridded, cmap, norm, vmin, vmax, alpha=alpha)
    upload(png, key)
    log.info(f'OK: {key} ({len(png):,} bytes)')


# ---------------------------------------------------------------------------
# RAP rendering
# ---------------------------------------------------------------------------

def run_rap(date: str, run: str):
    results = []
    forecast_hours = [0, 1, 2, 3]   # analysis + 3-hour forecast

    for fhr in forecast_hours:
        tag = f'f{fhr:02d}'
        log.info(f'=== RAP {run}z {tag} ===')

        # --- Composite reflectivity ---
        try:
            url = rap_url(date, run, fhr, ['REFC'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'atmosphere', 'shortName': 'refc'})
            render_and_upload(vals, lats, lons, radar_cmap,
                              f'models/rap/refl_{tag}.png', alpha=0.88)
            results.append({'key': f'models/rap/refl_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'RAP refl {tag}: {e}')
            results.append({'key': f'models/rap/refl_{tag}.png', 'ok': False})

        # --- Surface temperature (K → °F) ---
        try:
            url = rap_url(date, run, fhr, ['TMP'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'heightAboveGround', 'level': 2})
            render_and_upload(vals, lats, lons, temp_cmap,
                              f'models/rap/sfc_temp_{tag}.png',
                              transform_fn=lambda v: c_to_f(v - 273.15))
            results.append({'key': f'models/rap/sfc_temp_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'RAP temp {tag}: {e}')
            results.append({'key': f'models/rap/sfc_temp_{tag}.png', 'ok': False})

        # --- CAPE ---
        try:
            url = rap_url(date, run, fhr, ['CAPE'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'surface'})
            render_and_upload(vals, lats, lons, cape_cmap,
                              f'models/rap/cape_{tag}.png', alpha=0.82)
            results.append({'key': f'models/rap/cape_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'RAP CAPE {tag}: {e}')
            results.append({'key': f'models/rap/cape_{tag}.png', 'ok': False})

    upload_json({
        'updated_utc': now_utc_iso(),
        'model': 'RAP',
        'run_date': date, 'run_hour': run,
        'products': [r['key'] for r in results if r['ok']],
        'bounds': {'west': -130, 'east': -60, 'south': 20, 'north': 55},
    }, 'models/rap/metadata.json')

    return results


# ---------------------------------------------------------------------------
# GFS rendering
# ---------------------------------------------------------------------------

def run_gfs(date: str, run: str):
    results = []
    forecast_hours = [0, 6, 12, 24, 48]

    for fhr in forecast_hours:
        tag = f'f{fhr:03d}'
        log.info(f'=== GFS {run}z {tag} ===')

        # --- Surface CAPE ---
        try:
            url = gfs_url(date, run, fhr, ['CAPE'], ['lev_surface=on'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'surface', 'shortName': 'cape'})
            render_and_upload(vals, lats, lons, cape_cmap,
                              f'models/gfs/cape_{tag}.png', alpha=0.82)
            results.append({'key': f'models/gfs/cape_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GFS CAPE {tag}: {e}')
            results.append({'key': f'models/gfs/cape_{tag}.png', 'ok': False})

        # --- Mean sea level pressure (Pa → hPa) ---
        try:
            url = gfs_url(date, run, fhr, ['MSLET'], ['lev_mean_sea_level=on'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'meanSea'})
            render_and_upload(vals, lats, lons, mslp_cmap,
                              f'models/gfs/mslp_{tag}.png',
                              transform_fn=pa_to_hpa, alpha=0.75)
            results.append({'key': f'models/gfs/mslp_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GFS MSLP {tag}: {e}')
            results.append({'key': f'models/gfs/mslp_{tag}.png', 'ok': False})

        # --- 500 mb geopotential height ---
        try:
            url = gfs_url(date, run, fhr, ['HGT'], ['lev_500_mb=on'])
            vals, lats, lons, _ = download_grib(url,
                filter_by_keys={'typeOfLevel': 'isobaricInhPa', 'level': 500})
            # Render as a simple monochrome contour-style layer
            from common import mcolors, matplotlib
            cmap = matplotlib.colormaps.get_cmap('Blues').copy()
            cmap.set_bad(alpha=0)
            png = render_field(regrid_to_conus(vals, lats, lons),
                               cmap, None, 4920, 6000, alpha=0.72)
            upload(png, f'models/gfs/hgt500_{tag}.png')
            results.append({'key': f'models/gfs/hgt500_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GFS 500mb HGT {tag}: {e}')
            results.append({'key': f'models/gfs/hgt500_{tag}.png', 'ok': False})

    upload_json({
        'updated_utc': now_utc_iso(),
        'model': 'GFS',
        'run_date': date, 'run_hour': run,
        'products': [r['key'] for r in results if r['ok']],
        'bounds': {'west': -130, 'east': -60, 'south': 20, 'north': 55},
    }, 'models/gfs/metadata.json')

    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, choices=['rap', 'gfs'])
    args = parser.parse_args()

    try:
        date, run = find_latest_run(args.model)
    except RuntimeError as e:
        log.error(str(e))
        sys.exit(1)

    if args.model == 'rap':
        results = run_rap(date, run)
    else:
        results = run_gfs(date, run)

    failed = [r for r in results if not r.get('ok')]
    if failed:
        log.warning(f'{len(failed)} product(s) failed: {[r["key"] for r in failed]}')
        # Non-fatal: partial success is still useful
    log.info(f'{args.model.upper()} rendering complete.')
