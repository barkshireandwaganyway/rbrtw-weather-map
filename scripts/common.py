"""
common.py — shared utilities for RBRTW weather backend scripts.
Handles R2 upload, GRIB2 reading, regridding, and PNG rendering.
"""

import os
import io
import gzip
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import boto3
from botocore.config import Config
from scipy.interpolate import griddata

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment / Config
# ---------------------------------------------------------------------------
# Set these as GitHub Actions secrets (Settings → Secrets → Actions):
#   R2_ENDPOINT   → https://<account_id>.r2.cloudflarestorage.com
#   R2_ACCESS_KEY → Cloudflare R2 Access Key ID
#   R2_SECRET_KEY → Cloudflare R2 Secret Access Key
#   R2_BUCKET     → your-bucket-name  (e.g. rbrtw-weather-data)
#   R2_PUBLIC_URL → https://pub-<hash>.r2.dev  (from R2 bucket settings)

R2_ENDPOINT   = os.environ.get('R2_ENDPOINT', '')
R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY', '')
R2_SECRET_KEY = os.environ.get('R2_SECRET_KEY', '')
R2_BUCKET     = os.environ.get('R2_BUCKET', 'rbrtw-weather-data')
R2_PUBLIC_URL = os.environ.get('R2_PUBLIC_URL', '')

# ---------------------------------------------------------------------------
# CONUS rendering bounds (must match app.js LAYER_REGISTRY bounds)
# ---------------------------------------------------------------------------
BOUNDS_W, BOUNDS_E = -130.0, -60.0
BOUNDS_S, BOUNDS_N = 20.0,   55.0
IMG_W = 2000
IMG_H = int(IMG_W * (BOUNDS_N - BOUNDS_S) / (BOUNDS_E - BOUNDS_W))

# ---------------------------------------------------------------------------
# Color maps
# ---------------------------------------------------------------------------

def radar_cmap():
    """Standard NWS radar reflectivity color table (0–75 dBZ)."""
    colors = [
        (0,  '#00000000'),  # transparent
        (5,  '#04e9e7'),
        (10, '#019ff4'),
        (15, '#0300f4'),
        (20, '#02fd02'),
        (25, '#01c501'),
        (30, '#008e00'),
        (35, '#fdf802'),
        (40, '#e5bc00'),
        (45, '#fd9500'),
        (50, '#fd0000'),
        (55, '#d40000'),
        (60, '#bc0000'),
        (65, '#f800fd'),
        (70, '#9854c6'),
        (75, '#ffffff'),
    ]
    dbz_vals  = [c[0] for c in colors]
    hex_colors = [c[1] for c in colors]
    norm = mcolors.BoundaryNorm(dbz_vals, len(dbz_vals) - 1, clip=True)
    cmap = mcolors.ListedColormap(hex_colors[1:], name='radar')
    return cmap, norm, (0, 75)

def cc_cmap():
    """Correlation Coefficient: gray → blue → green → yellow → red."""
    cmap = mcolors.LinearSegmentedColormap.from_list('cc', [
        (0.00, '#808080'), (0.50, '#4466ff'), (0.70, '#00cc44'),
        (0.85, '#ffff00'), (0.93, '#ff8800'), (1.00, '#ff2200'),
    ])
    cmap.set_bad(alpha=0)
    cmap.set_under(alpha=0)
    return cmap, None, (0.2, 1.0)

def zdr_cmap():
    """Differential Reflectivity: blue (neg) → white (0) → red (pos)."""
    cmap = matplotlib.colormaps.get_cmap('RdBu_r').copy()
    cmap.set_bad(alpha=0)
    cmap.set_under(alpha=0)
    norm = mcolors.TwoSlopeNorm(vcenter=0.0, vmin=-2.0, vmax=6.0)
    return cmap, norm, (-2.0, 6.0)

def cape_cmap():
    """CAPE: transparent → yellow → orange → deep red."""
    cmap = mcolors.LinearSegmentedColormap.from_list('cape', [
        (0.0,  '#00000000'),
        (0.05, '#ffff44cc'),
        (0.3,  '#ff9900dd'),
        (0.6,  '#ff3300ee'),
        (1.0,  '#7f0000ff'),
    ])
    cmap.set_bad(alpha=0)
    return cmap, None, (0, 4000)

def temp_cmap():
    """Surface temperature: blue (cold) → green → yellow → red (hot)."""
    cmap = mcolors.LinearSegmentedColormap.from_list('temp_f', [
        (0.0,  '#2b1a78'), (0.15, '#4f8cff'), (0.30, '#66d9ff'),
        (0.45, '#7bd88f'), (0.60, '#f5c542'), (0.75, '#ff8c00'),
        (0.90, '#ff3b3b'), (1.0,  '#7f0000'),
    ])
    cmap.set_bad(alpha=0)
    return cmap, None, (-40, 120)   # °F

def echo_tops_cmap():
    """Echo tops: transparent → teal → yellow → white."""
    cmap = mcolors.LinearSegmentedColormap.from_list('echo_tops', [
        (0.0,  '#00000000'),
        (0.05, '#00cccc88'),
        (0.3,  '#00ff00bb'),
        (0.6,  '#ffff00cc'),
        (0.85, '#ff8800dd'),
        (1.0,  '#ffffffff'),
    ])
    cmap.set_bad(alpha=0)
    return cmap, None, (0, 60000)   # feet

def mslp_cmap():
    """MSLP: blue (low) → white → red (high)."""
    cmap = matplotlib.colormaps.get_cmap('RdBu_r').copy()
    cmap.set_bad(alpha=0)
    return cmap, None, (960, 1040)  # hPa

# ---------------------------------------------------------------------------
# R2 upload / local fallback
# ---------------------------------------------------------------------------

def r2_client():
    if not R2_ENDPOINT or not R2_ENDPOINT.startswith('https://') or '.r2.cloudflarestorage.com' not in R2_ENDPOINT:
        raise RuntimeError(
            'R2_ENDPOINT secret is missing or not a valid R2 S3 API endpoint.\n'
            'It must look like: https://<ACCOUNT_ID>.r2.cloudflarestorage.com\n'
            'This is DIFFERENT from the public r2.dev URL (that one goes in R2_PUBLIC_URL).\n'
            'Find your Account ID in the Cloudflare dashboard sidebar (R2 → Overview), '
            'or in the URL when viewing your account.\n'
            f'Current value seen (length {len(R2_ENDPOINT)}): {"<empty>" if not R2_ENDPOINT else "<set but invalid format>"}'
        )
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )


def upload(data: bytes, key: str, content_type: str = 'image/png',
           cache_seconds: int = 120):
    """
    Upload bytes to Cloudflare R2.
    Falls back to writing ./public/data/<key> when R2_ENDPOINT is not set
    (useful for local testing: serve public/ with `npx serve public`).
    """
    if not R2_ENDPOINT:
        local = Path('public/data') / key
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(data)
        log.info(f'[local] wrote {len(data):,} bytes → {local}')
        return

    client = r2_client()
    client.put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl=f'public, max-age={cache_seconds}',
    )
    log.info(f'[R2] uploaded {len(data):,} bytes → {key}')


def upload_json(obj: dict, key: str):
    upload(json.dumps(obj, indent=2).encode(), key, 'application/json', cache_seconds=60)

# ---------------------------------------------------------------------------
# GRIB2 reading
# ---------------------------------------------------------------------------

def read_grib2_bytes(raw: bytes, filter_by_keys: dict = None):
    """
    Write raw GRIB2 bytes to a temp file, open with cfgrib, return
    (values_2d, lats_2d, lons_2d, attrs_dict).
    filter_by_keys is passed to cfgrib to select a specific field
    when a file contains multiple messages (e.g. {'typeOfLevel': 'surface'}).
    """
    import cfgrib

    with tempfile.NamedTemporaryFile(suffix='.grib2', delete=False) as f:
        f.write(raw)
        tmp = Path(f.name)

    try:
        kwargs = dict(engine='cfgrib', backend_kwargs={'errors': 'warn'})
        if filter_by_keys:
            kwargs['filter_by_keys'] = filter_by_keys

        ds = cfgrib.open_dataset(tmp, **kwargs)
        var = list(ds.data_vars)[0]
        da = ds[var]
        vals = da.values.astype(float)

        # cfgrib gives 1-D or 2-D lat/lon depending on grid type
        lat = da.coords.get('latitude', ds.coords.get('latitude'))
        lon = da.coords.get('longitude', ds.coords.get('longitude'))
        if lat is None or lon is None:
            raise ValueError('No lat/lon coordinates in dataset')

        lats = lat.values
        lons = lon.values

        # Ensure 2-D arrays
        if lats.ndim == 1 and lons.ndim == 1:
            lons, lats = np.meshgrid(lons, lats)

        return vals, lats, lons, da.attrs

    finally:
        tmp.unlink(missing_ok=True)


def regrid_to_conus(values, lats, lons, w=IMG_W, h=IMG_H):
    """
    Interpolate an irregularly-spaced or projected field onto a regular
    lat-lon grid covering the CONUS bounding box.
    Uses nearest-neighbor for speed; switch to 'linear' for smoother output.
    """
    # Mask fill values (typically 9999 or -9999 in MRMS/model data)
    mask = (values > 9000) | (values < -9000) | ~np.isfinite(values)
    values = np.where(mask, np.nan, values)

    target_lon = np.linspace(BOUNDS_W, BOUNDS_E, w)
    target_lat = np.linspace(BOUNDS_S, BOUNDS_N, h)
    grid_lon, grid_lat = np.meshgrid(target_lon, target_lat)

    flat_pts  = np.column_stack([lons.ravel(), lats.ravel()])
    flat_vals = values.ravel()

    # Remove NaN source points before interpolation
    valid = np.isfinite(flat_vals)
    if valid.sum() < 10:
        return np.full((h, w), np.nan)

    gridded = griddata(flat_pts[valid], flat_vals[valid],
                       (grid_lon, grid_lat), method='nearest')
    # Re-mask areas far from any source point (edge artifacts)
    return gridded

# ---------------------------------------------------------------------------
# PNG rendering
# ---------------------------------------------------------------------------

def render_field(data_2d, cmap, norm, vmin, vmax,
                 alpha: float = 0.85, dpi: int = 100) -> bytes:
    """
    Render a 2-D CONUS-gridded field to a transparent PNG.
    data_2d: shape (IMG_H, IMG_W), values on CONUS lat-lon grid.
    Returns PNG bytes.
    """
    if isinstance(cmap, str):
        cmap = matplotlib.colormaps.get_cmap(cmap).copy()
    else:
        cmap = cmap.copy()
    cmap.set_bad(alpha=0)
    cmap.set_under(alpha=0)

    fig_w = IMG_W / dpi
    fig_h = IMG_H / dpi
    fig = plt.figure(figsize=(fig_w, fig_h), dpi=dpi)
    ax  = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    fig.patch.set_alpha(0)
    ax.set_facecolor((0, 0, 0, 0))

    if norm is not None:
        ax.imshow(data_2d, origin='lower', cmap=cmap, norm=norm,
                  aspect='auto', alpha=alpha, interpolation='nearest')
    else:
        ax.imshow(data_2d, origin='lower', cmap=cmap,
                  vmin=vmin, vmax=vmax,
                  aspect='auto', alpha=alpha, interpolation='nearest')

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, transparent=True,
                bbox_inches=None, pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
