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
    cape_cmap, temp_cmap, mslp_cmap, radar_cmap, public_s3_client, fetch_grib_message,
    read_grib2_bytes, regrid_to_conus, render_field,
    upload, upload_json, now_utc_iso,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('render_models')

NOMADS = 'https://nomads.ncep.noaa.gov'

# GFS is read directly from NOAA's public S3 bucket (same proven approach as
# MRMS) rather than the NOMADS GRIB-filter API, which carries the same
# IP-range bot-detection risk that blocked GitHub Actions on mrms.ncep.noaa.gov.
# A full GFS pgrb2.0p25 file is 300-600MB, so we use the companion .idx file
# to fetch only the one variable/level we need via an HTTP byte-range
# request (see fetch_grib_message in common.py), instead of downloading the
# whole file just to read one field.
GFS_BUCKET = 'noaa-gfs-bdp-pds'

# RAP still uses NOMADS directly — it has not shown the same bot-detection
# issue as MRMS did. If it ever starts failing with 403 Forbidden, NOAA also
# publishes RAP to s3://noaa-rap-pds using the identical pattern below.

# ---- Subregion filter (CONUS) ---- passed to NOMADS filter API
SUBREGION = 'subregion=&toplat=55&leftlon=-130&rightlon=-60&bottomlat=20'


# ---------------------------------------------------------------------------
# Latest-run discovery
# ---------------------------------------------------------------------------

def find_latest_run(model: str) -> tuple[str, str]:
    """
    Return (YYYYMMDD, HH) of the latest available model run.
    Checks the last 24-48 hours, starting from now.
    """
    now = datetime.now(timezone.utc)
    if model == 'rap':
        cycle_hours = list(range(23, -1, -1))      # RAP runs every hour
        for day_offset in range(2):
            date_str = (now - timedelta(days=day_offset)).strftime('%Y%m%d')
            for h in cycle_hours:
                url = f'{NOMADS}/pub/data/nccf/com/rap/prod/rap.{date_str}/rap.t{h:02d}z.wrfprsf00.grib2'
                try:
                    r = requests.head(url, timeout=10,
                                      headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'})
                    if r.status_code in (200, 302):
                        log.info(f'Latest rap run: {date_str}/{h:02d}z')
                        return date_str, f'{h:02d}'
                except Exception:
                    pass
        raise RuntimeError('Could not find a recent RAP run on NOMADS')

    elif model == 'gfs':
        s3 = public_s3_client()
        for day_offset in range(2):
            date_str = (now - timedelta(days=day_offset)).strftime('%Y%m%d')
            for h in ('18', '12', '06', '00'):
                key = f'gfs.{date_str}/{h}/atmos/gfs.t{h}z.pgrb2.0p25.f000'
                try:
                    s3.head_object(Bucket=GFS_BUCKET, Key=key)
                    log.info(f'Latest gfs run: {date_str}/{h}z (s3://{GFS_BUCKET}/{key})')
                    return date_str, h
                except Exception:
                    continue
        raise RuntimeError(f'Could not find a recent GFS run on s3://{GFS_BUCKET}')

    else:
        raise ValueError(f'Unknown model: {model}')


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


# ---------------------------------------------------------------------------
# Download + process a single model field
# ---------------------------------------------------------------------------

def download_grib(url: str, filter_by_keys: dict = None):
    log.info(f'GET {url[:100]}…')
    resp = requests.get(url, timeout=120,
                        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'})
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
    s3 = public_s3_client()
    results = []
    forecast_hours = [0, 6, 12, 24, 48]

    for fhr in forecast_hours:
        tag = f'f{fhr:03d}'
        grib_key = f'gfs.{date}/{run}/atmos/gfs.t{run}z.pgrb2.0p25.f{fhr:03d}'
        log.info(f'=== GFS {run}z {tag} (s3://{GFS_BUCKET}/{grib_key}) ===')

        # --- Surface CAPE ---
        try:
            raw = fetch_grib_message(s3, GFS_BUCKET, grib_key,
                lambda v, l: v == 'CAPE' and l == 'surface')
            vals, lats, lons, _ = read_grib2_bytes(raw)
            render_and_upload(vals, lats, lons, cape_cmap,
                              f'models/gfs/cape_{tag}.png', alpha=0.82)
            results.append({'key': f'models/gfs/cape_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GFS CAPE {tag}: {e}')
            results.append({'key': f'models/gfs/cape_{tag}.png', 'ok': False})

        # --- Mean sea level pressure (Pa → hPa) ---
        # PRMSL is the standard GFS mean-sea-level-pressure field.
        try:
            raw = fetch_grib_message(s3, GFS_BUCKET, grib_key,
                lambda v, l: v == 'PRMSL' and l == 'mean sea level')
            vals, lats, lons, _ = read_grib2_bytes(raw)
            render_and_upload(vals, lats, lons, mslp_cmap,
                              f'models/gfs/mslp_{tag}.png',
                              transform_fn=pa_to_hpa, alpha=0.75)
            results.append({'key': f'models/gfs/mslp_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GFS MSLP {tag}: {e}')
            results.append({'key': f'models/gfs/mslp_{tag}.png', 'ok': False})

        # --- 500 mb geopotential height ---
        try:
            raw = fetch_grib_message(s3, GFS_BUCKET, grib_key,
                lambda v, l: v == 'HGT' and l == '500 mb')
            vals, lats, lons, _ = read_grib2_bytes(raw)
            # Render as a simple monochrome contour-style layer
            from common import matplotlib
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
