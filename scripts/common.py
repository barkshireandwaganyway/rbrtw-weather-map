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
    Write raw GRIB2 bytes to a temp file, open with cfgrib via xarray, return
    (values_2d, lats_2d, lons_2d, attrs_dict).
    filter_by_keys is passed through to cfgrib to select a specific field
    when a file contains multiple messages (e.g. {'typeOfLevel': 'surface'}).

    NOTE: we go through xarray.open_dataset(engine='cfgrib') rather than
    calling cfgrib.open_dataset() directly. The direct call has been seen to
    fail with "module 'cfgrib' has no attribute 'open_dataset'" in some
    install configurations (likely a partially-initialized module when the
    eccodes C library isn't fully available at import time). Going through
    xarray's plugin-dispatch mechanism is the officially documented usage
    pattern for cfgrib and does not depend on that top-level convenience
    function existing.
    """
    import xarray as xr

    with tempfile.NamedTemporaryFile(suffix='.grib2', delete=False) as f:
        f.write(raw)
        tmp = Path(f.name)

    try:
        backend_kwargs = {'errors': 'warn'}
        if filter_by_keys:
            backend_kwargs['filter_by_keys'] = filter_by_keys

        ds = xr.open_dataset(tmp, engine='cfgrib', backend_kwargs=backend_kwargs)
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


def regrid_to_conus(values, lats, lons, w=IMG_W, h=IMG_H, max_extrapolate_deg=0.08):
    """
    Interpolate an irregularly-spaced or projected field onto a regular
    lat-lon grid covering the CONUS bounding box.

    IMPORTANT: scipy.interpolate.griddata(method='nearest') has no concept
    of "too far" — it will extrapolate the nearest real data point across
    the ENTIRE destination grid, even thousands of miles from any actual
    coverage. For sparse products (dual-pol fields only valid near active
    radar returns) this silently paints one extrapolated value across the
    whole map (solid color, or solid transparent if that value happens to
    fall outside the colormap's visible range) instead of leaving areas
    with no real data blank. We fix this by masking out any destination
    pixel whose nearest real source point is farther than
    `max_extrapolate_deg` away (~0.08° ≈ 9 km by default — tight enough to
    follow real coverage edges, loose enough to avoid speckling gaps
    between adjacent radar sites).
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

    src_pts = flat_pts[valid]
    gridded = griddata(src_pts, flat_vals[valid],
                       (grid_lon, grid_lat), method='nearest')

    # Actually compute distance-to-nearest-real-point and mask anything
    # too far away — this is the step that was previously just a comment.
    from scipy.spatial import cKDTree
    tree = cKDTree(src_pts)
    dest_pts = np.column_stack([grid_lon.ravel(), grid_lat.ravel()])
    dist, _ = tree.query(dest_pts, k=1)
    too_far = dist.reshape(h, w) > max_extrapolate_deg
    gridded = np.where(too_far, np.nan, gridded)

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

def public_s3_client(region: str = 'us-east-1'):
    """
    Anonymous (unsigned) S3 client for NOAA's public Open Data buckets
    (noaa-gfs-bdp-pds, noaa-gefs-pds, noaa-mrms-pds, etc). No AWS account or
    credentials needed — this is unrelated to your own R2 keys, which are
    handled separately by r2_client() above.
    """
    import boto3
    from botocore import UNSIGNED
    return boto3.client('s3', config=Config(signature_version=UNSIGNED), region_name=region)

# ---------------------------------------------------------------------------
# S3 byte-range GRIB fetching
# ---------------------------------------------------------------------------
# Full GFS/GEFS GRIB2 files are 300-600MB and contain hundreds of variables.
# Downloading the whole file just to read one field would be wasteful and
# slow on a GitHub Actions runner. NCEP publishes a companion ".idx" file
# alongside every GRIB2 file — a small plain-text index listing the byte
# offset of every variable/level "message" inside the GRIB2 file. We fetch
# that small index first, find the byte range for just the one message we
# want, then issue a single HTTP Range request for only those bytes
# (typically a few KB to low MB, not hundreds of MB). This is the standard
# technique used by tools like Herbie for exactly this situation, and is
# what replaces the NOMADS GRIB-filter API's server-side filtering now that
# we're reading directly from S3.

def s3_text_get(s3, bucket: str, key: str) -> str:
    """Fetch a small text file (like a .idx) fully into memory."""
    obj = s3.get_object(Bucket=bucket, Key=key)
    return obj['Body'].read().decode('utf-8', errors='replace')


def s3_get_range(s3, bucket: str, key: str, start: int, end):
    """Fetch a byte range from an S3 object. end=None means to EOF."""
    range_header = f'bytes={start}-{end}' if end is not None else f'bytes={start}-'
    obj = s3.get_object(Bucket=bucket, Key=key, Range=range_header)
    return obj['Body'].read()


def find_idx_byte_range(idx_text: str, match_fn):
    """
    Parse an NCEP .idx file. Each line looks like:
      'N:offset:date:VAR:LEVEL:forecast_info:...'
    match_fn(var, level) -> bool selects the desired message.
    Returns (start_byte, end_byte_or_None); end=None means "to end of file"
    (true for whichever message happens to be last in the file).
    """
    parsed = []
    for line in idx_text.strip().split('\n'):
        parts = line.strip().split(':')
        if len(parts) < 5:
            continue
        try:
            offset = int(parts[1])
        except ValueError:
            continue
        parsed.append((offset, parts[3], parts[4]))
    for i, (offset, var, level) in enumerate(parsed):
        if match_fn(var, level):
            start = offset
            end = parsed[i + 1][0] - 1 if i + 1 < len(parsed) else None
            return start, end
    return None, None


def fetch_grib_message(s3, bucket: str, grib_key: str, match_fn) -> bytes:
    """
    Fetch just ONE variable/level message from a large GRIB2 file on S3,
    using its companion .idx file to find the byte range — avoids
    downloading the full (often 300-600MB) file for a single field.
    Raises RuntimeError with the available variable list if match_fn
    doesn't match anything, so a wrong guess fails with something
    immediately actionable instead of a silent empty result.
    """
    idx_text = s3_text_get(s3, bucket, grib_key + '.idx')
    start, end = find_idx_byte_range(idx_text, match_fn)
    if start is None:
        available = sorted(set(
            f'{p.split(":")[3]}:{p.split(":")[4]}'
            for p in idx_text.strip().split('\n') if p.count(':') >= 4
        ))
        raise RuntimeError(
            f'No matching GRIB message in {grib_key}.idx. '
            f'First 20 available var:level combos: {available[:20]}'
        )
    return s3_get_range(s3, bucket, grib_key, start, end)


def spread_cmap():
    """Ensemble spread: transparent (low spread/high confidence) through
    blue -> yellow -> red (high spread/low confidence, more uncertainty)."""
    cmap = mcolors.LinearSegmentedColormap.from_list('spread', [
        (0.0,  '#00000000'),
        (0.10, '#3b82f680'),
        (0.40, '#facc15cc'),
        (0.70, '#f97316dd'),
        (1.0,  '#dc2626ff'),
    ])
    cmap.set_bad(alpha=0)
    return cmap, None, (0, 1)  # caller rescales per-field; placeholder range
