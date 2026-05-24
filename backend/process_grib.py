import json
import os
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

def reflectivity_color(value):
    if value < 5:
        return (0, 0, 0, 0)
    if value < 20:
        return (0.0, 0.8, 0.2, 0.45)
    if value < 35:
        return (1.0, 1.0, 0.0, 0.55)
    if value < 50:
        return (1.0, 0.3, 0.0, 0.65)
    if value < 65:
        return (1.0, 0.0, 0.0, 0.75)
    return (1.0, 0.0, 1.0, 0.85)

def save_reflectivity_png(grib_path, png_path):
    ds = xr.open_dataset(
        grib_path,
        engine="cfgrib",
        backend_kwargs={
            "indexpath": "",
            "filter_by_keys": {
                "typeOfLevel": "entireAtmosphere"
            }
        }
    )

    var_name = list(ds.data_vars)[0]
    data = ds[var_name].values

    data = np.nan_to_num(data, nan=0.0)

    rgba = np.zeros((data.shape[0], data.shape[1], 4), dtype=float)

    for y in range(data.shape[0]):
        for x in range(data.shape[1]):
            rgba[y, x] = reflectivity_color(data[y, x])

    plt.imsave(png_path, rgba)

def main():
    frames = []

    for hour in range(1, 19):
        grib_file = OUT_DIR / f"hrrr_refc_f{hour:02d}.grib2"
        png_file = OUT_DIR / f"hrrr_refc_f{hour:02d}.png"

        if not grib_file.exists():
            continue

        print(f"Processing {grib_file}")
        save_reflectivity_png(grib_file, png_file)

        frames.append({
            "hour": hour,
            "file": f"public/data/model/hrrr/{png_file.name}",
            "label": f"F{hour:02d}"
        })

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
