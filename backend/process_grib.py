import json
from pathlib import Path

import numpy as np
import xarray as xr
import matplotlib.pyplot as plt

OUT_DIR = Path("public/data/model/hrrr")
OUT_DIR.mkdir(parents=True, exist_ok=True)

BOUNDS = {
    "south": 27.5,
    "west": -101.5,
    "north": 31.0,
    "east": -96.5
}

def reflectivity_to_rgba(data):
    data = np.nan_to_num(data, nan=0.0)

    rgba = np.zeros((data.shape[0], data.shape[1], 4), dtype=np.float32)

    rgba[(data >= 5) & (data < 20)] = [0.0, 0.8, 0.2, 0.45]
    rgba[(data >= 20) & (data < 35)] = [1.0, 1.0, 0.0, 0.55]
    rgba[(data >= 35) & (data < 50)] = [1.0, 0.35, 0.0, 0.65]
    rgba[(data >= 50) & (data < 65)] = [1.0, 0.0, 0.0, 0.75]
    rgba[data >= 65] = [1.0, 0.0, 1.0, 0.85]

    return rgba

def open_first_valid_dataset(grib_path):
    datasets = xr.open_mfdataset(
        [grib_path],
        engine="cfgrib",
        backend_kwargs={"indexpath": ""}
    )

    if len(datasets.data_vars) > 0:
        return datasets

    all_sets = xr.backends.api.open_dataset(
        grib_path,
        engine="cfgrib",
        backend_kwargs={"indexpath": ""}
    )

    return all_sets

def save_reflectivity_png(grib_path, png_path):
    try:
        ds = xr.open_dataset(
            grib_path,
            engine="cfgrib",
            backend_kwargs={"indexpath": ""}
        )
    except Exception:
        ds_list = xr.open_datasets(
            grib_path,
            engine="cfgrib",
            backend_kwargs={"indexpath": ""}
        )

        ds = None
        for item in ds_list:
            if len(item.data_vars) > 0:
                ds = item
                break

        if ds is None:
            raise RuntimeError(f"No readable data variables found in {grib_path}")

    data_vars = list(ds.data_vars)

    if not data_vars:
        raise RuntimeError(f"No data variables found in {grib_path}")

    var_name = data_vars[0]
    data = ds[var_name].values

    if data.ndim > 2:
        data = data[0]

    rgba = reflectivity_to_rgba(data)

    plt.imsave(png_path, rgba)

def main():
    frames = []

    for hour in range(1, 19):
        grib_file = OUT_DIR / f"hrrr_refc_f{hour:02d}.grib2"
        png_file = OUT_DIR / f"hrrr_refc_f{hour:02d}.png"

        if not grib_file.exists():
            print(f"Missing {grib_file}")
            continue

        print(f"Processing {grib_file}")
        save_reflectivity_png(grib_file, png_file)

        frames.append({
            "hour": hour,
            "file": f"public/data/model/hrrr/{png_file.name}",
            "label": f"F{hour:02d}"
        })

    if not frames:
        raise RuntimeError("No HRRR PNG frames were created.")

    latest = {
        "status": "processed",
        "model": "HRRR",
        "product": "Composite Reflectivity",
        "bounds": BOUNDS,
        "frames": frames
    }

    with open(OUT_DIR / "latest.json", "w") as f:
        json.dump(latest, f, indent=2)

    print("PNG frame processing complete.")

if __name__ == "__main__":
    main()
