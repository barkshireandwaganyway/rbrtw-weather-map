#!/usr/bin/env python3
"""
render_mrms.py - Download and render MRMS dual-polarization products.

IMPORTANT: this script reads from NOAA's public AWS Open Data S3 bucket
(s3://noaa-mrms-pds), NOT the mrms.ncep.noaa.gov website.

Why: the mrms.ncep.noaa.gov HTTPS server runs bot-detection (likely an
IP-range/ASN block on cloud datacenter ranges, which is what GitHub-hosted
runners use) that returned 403 Forbidden even with a normal browser
User-Agent. NOAA separately publishes the same MRMS data to a free, public,
unauthenticated S3 bucket specifically for automated/cloud consumption -
this is the NOAA Big Data Program's intended access path for exactly this
use case, and is not subject to the website's bot-detection at all.
See: https://registry.opendata.aws/noaa-mrms-pds/

Products rendered:
  cc_latest.png        Correlation Coefficient  (0.50 deg tilt)
  zdr_latest.png       Differential Reflectivity (0.50 deg tilt)
  refl_latest.png      MRMS Composite Reflectivity
  echo_tops_latest.png MRMS Echo Tops (18 dBZ)

Each PNG is uploaded to Cloudflare R2 under the `mrms/` prefix.
The app.js reads from: {R2_PUBLIC_URL}/mrms/{filename}

Run schedule: every 15 minutes via GitHub Actions.
"""

import gzip
import io
import logging
import sys
from datetime import datetime, timezone, timedelta

import numpy as np
import boto3
from botocore import UNSIGNED
from botocore.config import Config as BotoConfig

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

MRMS_BUCKET = 'noaa-mrms-pds'


def mrms_s3_client():
    """Anonymous (unsigned) S3 client. This NOAA bucket is public - no AWS
    account or credentials needed. Unrelated to your own R2 keys."""
    return boto3.client(
        's3',
        config=BotoConfig(signature_version=UNSIGNED),
        region_name='us-east-1',
    )


# ---------------------------------------------------------------------------
# Product definitions
# ---------------------------------------------------------------------------
# 'folders' is a list of candidate S3 prefixes under CONUS/ - some products
# may use slightly different folder-naming conventions in the bucket vs the
# website, so we try each candidate and use whichever actually has files.
# ---------------------------------------------------------------------------
PRODUCTS = [
    {
        'name': 'Correlation Coefficient',
        'folders': ['CorrelationCoefficient_00.50'],
        'keywords': ['CorrelationCoefficient', 'RhoHV'],
        'key': 'mrms/cc_latest.png',
        'cmap_fn': cc_cmap,
        'fill_val': -999.0,
        'min_valid': 0.2,
    },
    {
        'name': 'Differential Reflectivity',
        'folders': ['DifferentialReflectivity_00.50'],
        'keywords': ['DifferentialReflectivity', 'ZDR'],
        'key': 'mrms/zdr_latest.png',
        'cmap_fn': zdr_cmap,
        'fill_val': -999.0,
    },
    {
        'name': 'MRMS Composite Reflectivity',
        'folders': ['MergedReflectivityQCComposite_00.50'],
        'keywords': ['MergedReflectivityQCComposite'],
        'key': 'mrms/refl_latest.png',
        'cmap_fn': radar_cmap,
        'fill_val': -999.0,
        'min_valid': 5.0,
    },
    {
        'name': 'Echo Tops 18 dBZ',
        'folders': ['EchoTop_18_00.00', 'EchoTop18_00.00'],
        'keywords': ['EchoTop'],
        'key': 'mrms/echo_tops_latest.png',
        'cmap_fn': echo_tops_cmap,
        'fill_val': -999.0,
        'scale': 3.28084,
        'min_valid': 1000,
    },
]


# Cache of all top-level CONUS/ folder names actually present in the bucket.
# Populated once (lazily) the first time a guessed folder name comes up empty.
_conus_folder_cache = None

def list_conus_folders(s3):
    """List all top-level product folder names under CONUS/ in the bucket."""
    global _conus_folder_cache
    if _conus_folder_cache is not None:
        return _conus_folder_cache
    folders = []
    paginator = s3.get_paginator('list_objects_v2')
    try:
        for page in paginator.paginate(Bucket=MRMS_BUCKET, Prefix='CONUS/', Delimiter='/'):
            for cp in page.get('CommonPrefixes', []):
                # cp['Prefix'] looks like 'CONUS/SomeFolderName/'
                name = cp['Prefix'].split('/')[1]
                folders.append(name)
    except Exception as e:
        log.warning(f'Could not list CONUS/ folders: {e}')
    _conus_folder_cache = folders
    log.info(f'Discovered {len(folders)} product folders under CONUS/')
    return folders


def find_latest_key(s3, folders, keywords=None):
    """
    Search today's (and yesterday's, for UTC day-boundary safety) date
    folder under each candidate prefix. Return (key, folder) of the most
    recently modified .grib2.gz object found, or (None, None).

    If none of the guessed `folders` have any files, and `keywords` is
    given, fall back to listing the bucket's real top-level CONUS/ folders
    and trying any whose name contains one of the keywords (case-insensitive
    substring match) — this self-corrects if the guessed folder name is
    slightly wrong, instead of just failing.
    """
    now = datetime.now(timezone.utc)

    def try_folder(folder):
        for day_offset in (0, 1):
            date_str = (now - timedelta(days=day_offset)).strftime('%Y%m%d')
            prefix = f'CONUS/{folder}/{date_str}/'
            latest_key, latest_mod = None, None
            paginator = s3.get_paginator('list_objects_v2')
            try:
                for page in paginator.paginate(Bucket=MRMS_BUCKET, Prefix=prefix):
                    for obj in page.get('Contents', []):
                        if not obj['Key'].endswith('.grib2.gz'):
                            continue
                        if latest_mod is None or obj['LastModified'] > latest_mod:
                            latest_mod = obj['LastModified']
                            latest_key = obj['Key']
            except Exception as e:
                log.warning(f'List failed for {prefix}: {e}')
                continue
            if latest_key:
                return latest_key
        return None

    for folder in folders:
        key = try_folder(folder)
        if key:
            return key, folder

    if keywords:
        log.info(f'Guessed folder name(s) {folders} had no files — '
                 f'searching real bucket listing for keywords {keywords}')
        real_folders = list_conus_folders(s3)
        matches = [f for f in real_folders if any(kw.lower() in f.lower() for kw in keywords)]
        if matches:
            log.info(f'Found possible matching folder(s): {matches}')
        for folder in matches:
            key = try_folder(folder)
            if key:
                log.info(f'Auto-corrected folder name: using "{folder}" '
                         f'instead of guessed {folders}')
                return key, folder

    return None, None


def download_from_s3(s3, key):
    log.info(f'GET s3://{MRMS_BUCKET}/{key}')
    obj = s3.get_object(Bucket=MRMS_BUCKET, Key=key)
    raw_gz = obj['Body'].read()
    with gzip.open(io.BytesIO(raw_gz)) as gz:
        return gz.read()


def process_product(s3, p):
    name = p['name']
    log.info(f'--- {name} ---')
    try:
        key, folder = find_latest_key(s3, p['folders'], p.get('keywords'))
        if not key:
            real_folders = list_conus_folders(s3)
            raise RuntimeError(
                f'No matching .grib2.gz files found. Tried: {p["folders"]}. '
                f'No folder matched keywords {p.get("keywords")} either. '
                f'Bucket actually has {len(real_folders)} CONUS/ folders — '
                f'check render_mrms log above for "Discovered N product folders" '
                f'or inspect them directly at https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/'
            )
        raw = download_from_s3(s3, key)
        values, lats, lons, attrs = read_grib2_bytes(raw)

        if p.get('scale'):
            values = values * p['scale']

        values = np.where(np.isclose(values, p.get('fill_val', -999.0), atol=1), np.nan, values)
        if p.get('min_valid') is not None:
            values = np.where(values < p['min_valid'], np.nan, values)

        gridded = regrid_to_conus(values, lats, lons)
        cmap, norm, (vmin, vmax) = p['cmap_fn']()
        png = render_field(gridded, cmap, norm, vmin, vmax, alpha=0.88)

        upload(png, p['key'])
        log.info(f'OK: {p["key"]} ({len(png):,} bytes, from CONUS/{folder}/)')
        return {'product': name, 'key': p['key'], 'ok': True}

    except Exception as e:
        log.error(f'FAILED {name}: {e}', exc_info=True)
        return {'product': name, 'ok': False, 'error': str(e)}


if __name__ == '__main__':
    s3 = mrms_s3_client()
    results = [process_product(s3, p) for p in PRODUCTS]

    ok_keys = [r['key'] for r in results if r['ok']]
    try:
        upload_json({
            'updated_utc': now_utc_iso(),
            'products': ok_keys,
            'bounds': {'west': -130, 'east': -60, 'south': 20, 'north': 55},
        }, 'mrms/metadata.json')
    except Exception as e:
        log.error(f'Could not write metadata.json: {e}')

    failed = [r for r in results if not r['ok']]
    if failed:
        log.error(f'Failed: {[r["product"] for r in failed]}')
        sys.exit(1)

    log.info('All MRMS products complete.')
