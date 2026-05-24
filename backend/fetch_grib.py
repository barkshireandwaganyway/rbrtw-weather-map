import os
import json
import requests
from datetime import datetime, timedelta, timezone

OUT_DIR = "public/data/model/hrrr"
os.makedirs(OUT_DIR, exist_ok=True)

LEFT_LON = -101.5
RIGHT_LON = -96.5
TOP_LAT = 31.0
BOTTOM_LAT = 27.5

FORECAST_HOURS = range(1, 19)

def hrrr_url(date, cycle, hour):
    ymd = date.strftime("%Y%m%d")
    file_name = f"hrrr.t{cycle:02d}z.wrfsfcf{hour:02d}.grib2"

    return (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl"
        f"?dir=%2Fhrrr.{ymd}%2Fconus"
        f"&file={file_name}"
        "&var_REFC=on"
        "&lev_entire_atmosphere=on"
        "&subregion="
        f"&leftlon={LEFT_LON}"
        f"&rightlon={RIGHT_LON}"
        f"&toplat={TOP_LAT}"
        f"&bottomlat={BOTTOM_LAT}"
    )

def try_download_latest():
    now = datetime.now(timezone.utc)

    attempts = []
    for day_offset in range(0, 2):
        date = now - timedelta(days=day_offset)
        for cycle in range(now.hour, -1, -1):
            attempts.append((date, cycle))

    for date, cycle in attempts:
        print(f"Trying HRRR cycle {date.strftime('%Y%m%d')} {cycle:02d}z")

        downloaded = []

        for hour in FORECAST_HOURS:
            url = hrrr_url(date, cycle, hour)
            file_name = f"hrrr_refc_f{hour:02d}.grib2"
            out_path = os.path.join(OUT_DIR, file_name)

            r = requests.get(url, timeout=60)

            if r.status_code != 200 or len(r.content) < 10000:
                print(f"Missing f{hour:02d}")
                break

            with open(out_path, "wb") as f:
                f.write(r.content)

            downloaded.append(file_name)
            print(f"Downloaded {file_name}")

        if len(downloaded) >= 3:
            latest_path = os.path.join(OUT_DIR, "latest.json")
            with open(latest_path, "w") as f:
                f.write(
                    "{\n"
                    '  "status": "downloaded",\n'
                    f'  "model": "HRRR",\n'
                    f'  "product": "Composite Reflectivity",\n'
                    f'  "cycle": "{date.strftime("%Y%m%d")} {cycle:02d}z",\n'
                    f'  "files": {downloaded}\n'
                    "}\n"
                )

            print("Success")
            return

    raise RuntimeError("No usable HRRR cycle found.")

if __name__ == "__main__":
    try_download_latest()
