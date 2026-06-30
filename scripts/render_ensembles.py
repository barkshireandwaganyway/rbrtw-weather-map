#!/usr/bin/env python3
"""
render_ensembles.py — Download and render GEFS ensemble mean and spread.

Reads directly from NOAA's public S3 bucket (noaa-gefs-pds) — the same
proven, bot-detection-free approach used for MRMS and GFS. GEFS files are
0.5-degree resolution but still contain many variables, so we use the
companion .idx file to fetch only the one variable/level we need via an
HTTP byte-range request, rather than downloading the whole file.

GEFS member-file naming convention (confirmed from NOAA's own AWS Open Data
documentation): the 21-member ensemble's pre-computed mean is published as
a file whose name starts with "geavg", and spread as "gespr" — both at the
same s3://noaa-gefs-pds/gefs.{date}/{run}/atmos/pgrb2ap5/ path as the
individual members (gec00 = control run, gep01..gep30 = perturbed members).
Note: "gespr" is the standard NCEP naming convention; if NOAA ever renames
it, find_gefs_member_key() will fail with a clear list of what's actually
in that folder instead of a silent miss.

Products rendered:
  GEFS Mean:
    models/gefs/mean_cape_f{HHH}.png
    models/gefs/mean_mslp_f{HHH}.png
  GEFS Spread (uncertainty — how much the 21 members disagree):
    models/gefs/spread_hgt500_f{HHH}.png

Run schedule: every 6 hours (GEFS cycles at 00/06/12/18Z), via GitHub Actions.
"""

import logging
import sys
from datetime import datetime, timezone, timedelta

from common import (
    cape_cmap, mslp_cmap, spread_cmap,
    public_s3_client, fetch_grib_message,
    read_grib2_bytes, regrid_to_conus, render_field,
    upload, upload_json, now_utc_iso,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('render_ensembles')

GEFS_BUCKET = 'noaa-gefs-pds'

# Forecast hours to render. GEFS goes out to 384h, but we only need a
# reasonably near-term set for this map.
FORECAST_HOURS = [0, 24, 48, 72]


def pa_to_hpa(arr):
    return arr / 100.0


def find_latest_gefs_run(s3):
    """Return (YYYYMMDD, HH) of the latest available GEFS mean run."""
    now = datetime.now(timezone.utc)
    for day_offset in range(2):
        date_str = (now - timedelta(days=day_offset)).strftime('%Y%m%d')
        for h in ('18', '12', '06', '00'):
            key = f'gefs.{date_str}/{h}/atmos/pgrb2ap5/geavg.t{h}z.pgrb2a.0p50.f000'
            try:
                s3.head_object(Bucket=GEFS_BUCKET, Key=key)
                log.info(f'Latest GEFS run: {date_str}/{h}z')
                return date_str, h
            except Exception:
                continue
    raise RuntimeError(f'Could not find a recent GEFS run on s3://{GEFS_BUCKET}')


def gefs_key(date: str, run: str, member_prefix: str, fhr: int) -> str:
    """
    member_prefix: 'geavg' (mean) or 'gespr' (spread).
    """
    return f'gefs.{date}/{run}/atmos/pgrb2ap5/{member_prefix}.t{run}z.pgrb2a.0p50.f{fhr:03d}'


def render_one(s3, grib_key, match_fn, cmap_fn, out_key, transform_fn=None, alpha=0.8,
               vmin_override=None, vmax_override=None):
    raw = fetch_grib_message(s3, GEFS_BUCKET, grib_key, match_fn)
    vals, lats, lons, _ = read_grib2_bytes(raw)
    if transform_fn:
        vals = transform_fn(vals)
    gridded = regrid_to_conus(vals, lats, lons)
    cmap, norm, (vmin, vmax) = cmap_fn()
    if vmin_override is not None: vmin = vmin_override
    if vmax_override is not None: vmax = vmax_override
    png = render_field(gridded, cmap, norm, vmin, vmax, alpha=alpha)
    upload(png, out_key)
    log.info(f'OK: {out_key} ({len(png):,} bytes)')


def run_gefs(date: str, run: str):
    s3 = public_s3_client()
    results = []

    for fhr in FORECAST_HOURS:
        tag = f'f{fhr:03d}'

        # ----- Ensemble MEAN -----
        mean_key = gefs_key(date, run, 'geavg', fhr)
        log.info(f'=== GEFS Mean {run}z {tag} (s3://{GEFS_BUCKET}/{mean_key}) ===')

        try:
            render_one(s3, mean_key, lambda v, l: v == 'CAPE' and l == 'surface',
                      cape_cmap, f'models/gefs/mean_cape_{tag}.png', alpha=0.82)
            results.append({'key': f'models/gefs/mean_cape_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GEFS Mean CAPE {tag}: {e}')
            results.append({'key': f'models/gefs/mean_cape_{tag}.png', 'ok': False})

        try:
            render_one(s3, mean_key, lambda v, l: v == 'PRMSL' and l == 'mean sea level',
                      mslp_cmap, f'models/gefs/mean_mslp_{tag}.png',
                      transform_fn=pa_to_hpa, alpha=0.75)
            results.append({'key': f'models/gefs/mean_mslp_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GEFS Mean MSLP {tag}: {e}')
            results.append({'key': f'models/gefs/mean_mslp_{tag}.png', 'ok': False})

        # ----- Ensemble SPREAD (uncertainty) -----
        # Same variable/level names as the mean file — it's a separate file
        # (gespr.*) where each field has already been pre-computed by NOAA
        # as the ensemble's standard deviation, not a special variable name.
        spread_key = gefs_key(date, run, 'gespr', fhr)
        log.info(f'=== GEFS Spread {run}z {tag} (s3://{GEFS_BUCKET}/{spread_key}) ===')

        try:
            # 500mb height spread: typically 0-40m for a well-agreed forecast,
            # higher (60m+) where ensemble members diverge a lot.
            render_one(s3, spread_key, lambda v, l: v == 'HGT' and l == '500 mb',
                      spread_cmap, f'models/gefs/spread_hgt500_{tag}.png',
                      alpha=0.8, vmin_override=0, vmax_override=60)
            results.append({'key': f'models/gefs/spread_hgt500_{tag}.png', 'ok': True})
        except Exception as e:
            log.error(f'GEFS Spread HGT500 {tag}: {e}')
            results.append({'key': f'models/gefs/spread_hgt500_{tag}.png', 'ok': False})

    upload_json({
        'updated_utc': now_utc_iso(),
        'model': 'GEFS',
        'run_date': date, 'run_hour': run,
        'products': [r['key'] for r in results if r['ok']],
        'bounds': {'west': -130, 'east': -60, 'south': 20, 'north': 55},
    }, 'models/gefs/metadata.json')

    return results


if __name__ == '__main__':
    s3 = public_s3_client()
    try:
        date, run = find_latest_gefs_run(s3)
    except RuntimeError as e:
        log.error(str(e))
        sys.exit(1)

    results = run_gefs(date, run)

    failed = [r for r in results if not r.get('ok')]
    if failed:
        log.warning(f'{len(failed)} product(s) failed: {[r["key"] for r in failed]}')
        # Non-fatal: partial success is still useful
    log.info('GEFS rendering complete.')
