from __future__ import annotations

import io
import json
import math
import mimetypes
import re
from functools import lru_cache
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image
import rasterio
from rasterio.io import MemoryFile
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(
    r"C:\Users\srangasw\OneDrive - UGent\Desktop\Europe_wind_turbines\Python_code_HP2P\outputs"
)
FREQUENCY_DIR = OUTPUT_ROOT / "Frequencies"
OVERALL_DIR = OUTPUT_ROOT / "Overall_SPL"

FREQUENCY_PATTERN = re.compile(
    r"^(?P<site>[A-Z]+_\d+)_receiver_all_(?P<freq>\d+(?:_\d+)?)Hz_Hub_(?P<hub>[^_]+)_Receiver_(?P<receiver>[^.]+)\.tif$"
)
OVERALL_PATTERN = re.compile(
    r"^(?P<site>[A-Z]+_\d+)_receiver_all_Hub_(?P<hub>[^_]+)_Receiver_(?P<receiver>[^.]+)\.tif$"
)

HUMAN_THRESHOLDS = {
    20: 78.5,
    25: 68.7,
    31.5: 59.5,
    40: 51.1,
    50: 44.0,
    63: 37.5,
    80: 31.5,
    100: 26.5,
    125: 22.1,
    160: 17.9,
    200: 14.4,
    250: 11.4,
    315: 8.6,
    400: 6.2,
    500: 4.4,
    630: 3.0,
    800: 2.2,
    1000: 2.4,
    1250: 3.5,
    1600: 1.7,
    2000: -1.3,
    2500: -4.2,
    3150: -6.0,
    4000: -5.4,
    5000: -1.5,
    6300: 6.0,
    8000: 12.6,
    10000: 13.9,
    12500: 12.3,
    16000: 18.4,
    20000: 40.2,
    25000: 55.0,
    31500: 75.0,
    40000: 95.0,
}


def site_sort_key(value: str) -> tuple[str, int]:
    prefix, _, number = value.partition("_")
    return prefix, int(number or 0)


def frequency_to_text(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return str(value).replace(".", "_")


def frequency_from_text(value: str) -> float:
    return float(value.replace("_", "."))


def load_data() -> dict:
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    payload = text.split("=", 1)[1].rsplit(";", 1)[0].strip()
    return json.loads(payload)


DATA = load_data()


def clean_points(campaign: dict) -> list[dict[str, float]]:
    buckets: dict[float, list[float]] = {}
    for row in campaign.get("measurements", []):
        try:
            frequency = float(row["frequency"])
            threshold = float(row["threshold"])
        except (KeyError, TypeError, ValueError):
            continue
        if frequency > 0 and math.isfinite(threshold):
            buckets.setdefault(frequency, []).append(threshold)
    return [
        {"frequency": frequency, "threshold": sum(values) / len(values)}
        for frequency, values in sorted(buckets.items())
    ]


def interpolate_threshold(points: list[dict[str, float]], frequency: float) -> float | None:
    if not points:
        return None
    if frequency < points[0]["frequency"] or frequency > points[-1]["frequency"]:
        return None
    for index in range(len(points) - 1):
        left = points[index]
        right = points[index + 1]
        if frequency == left["frequency"]:
            return left["threshold"]
        if frequency == right["frequency"]:
            return right["threshold"]
        if left["frequency"] < frequency < right["frequency"]:
            log_left = math.log10(left["frequency"])
            log_right = math.log10(right["frequency"])
            ratio = (math.log10(frequency) - log_left) / (log_right - log_left)
            return left["threshold"] + (right["threshold"] - left["threshold"]) * ratio
    return None


def equalizer_gain(species_id: str, campaign_id: str, frequency: float) -> float:
    species = next((item for item in DATA["species"] if item["id"] == species_id), None)
    if not species:
        raise ValueError(f"Unknown species: {species_id}")
    campaign = next((item for item in species["campaigns"] if item["id"] == campaign_id), None)
    if not campaign:
        campaign = species["campaigns"][0]
    animal_threshold = interpolate_threshold(clean_points(campaign), frequency)
    human_threshold = HUMAN_THRESHOLDS.get(frequency)
    if animal_threshold is None or human_threshold is None:
        return 0.0
    return human_threshold - animal_threshold


def scan_options() -> dict:
    sites: set[str] = set()
    hubs: set[str] = set()
    receivers: set[str] = set()
    frequencies: set[float] = set()

    for path in FREQUENCY_DIR.glob("*.tif"):
        match = FREQUENCY_PATTERN.match(path.name)
        if not match:
            continue
        parts = match.groupdict()
        sites.add(parts["site"])
        hubs.add(parts["hub"])
        receivers.add(parts["receiver"])
        frequencies.add(frequency_from_text(parts["freq"]))

    return {
        "sites": sorted(sites, key=site_sort_key),
        "hubs": sorted(hubs, key=lambda item: float(item.rstrip("m"))),
        "receivers": sorted(receivers, key=lambda item: float(item.rstrip("m").replace("p", "."))),
        "frequencies": sorted(frequencies),
    }


OPTIONS = scan_options()


def validated(value: str, allowed: list[str] | set[str], label: str) -> str:
    if value not in allowed:
        raise ValueError(f"Invalid {label}: {value}")
    return value


def frequency_path(site: str, frequency: float, hub: str, receiver: str) -> Path:
    filename = f"{site}_receiver_all_{frequency_to_text(frequency)}Hz_Hub_{hub}_Receiver_{receiver}.tif"
    path = FREQUENCY_DIR / filename
    if not path.exists():
        raise FileNotFoundError(filename)
    return path


def overall_path(site: str, hub: str, receiver: str) -> Path:
    filename = f"{site}_receiver_all_Hub_{hub}_Receiver_{receiver}.tif"
    path = OVERALL_DIR / filename
    if not path.exists():
        raise FileNotFoundError(filename)
    return path


def read_band(path: Path) -> tuple[np.ma.MaskedArray, dict]:
    with rasterio.open(path) as dataset:
        return dataset.read(1, masked=True).astype("float32"), dataset.profile.copy()


def combine_energy(layers: list[np.ma.MaskedArray]) -> np.ma.MaskedArray:
    if not layers:
        raise ValueError("No frequency layers selected.")
    power = None
    for layer in layers:
        contribution = np.ma.power(10.0, layer / 10.0)
        power = contribution if power is None else power + contribution
    return 10.0 * np.ma.log10(power)


def parse_request(query: dict[str, list[str]]) -> tuple[str, str, str, str, str, str, tuple[float, ...]]:
    species = query.get("species", [""])[0]
    campaign = query.get("campaign", [""])[0]
    mode = query.get("mode", ["broadband"])[0]
    site = validated(query.get("site", [OPTIONS["sites"][0]])[0], OPTIONS["sites"], "site")
    hub = validated(query.get("hub", [OPTIONS["hubs"][0]])[0], OPTIONS["hubs"], "hub")
    receiver = validated(query.get("receiver", [OPTIONS["receivers"][0]])[0], OPTIONS["receivers"], "receiver")
    if mode not in {"broadband", "overall", "frequency", "multi"}:
        raise ValueError(f"Invalid mode: {mode}")
    frequency_values = tuple(
        float(item)
        for item in query.get("freqs", [""])[0].split(",")
        if item.strip()
    )
    allowed_frequencies = set(OPTIONS["frequencies"])
    for frequency in frequency_values:
        if frequency not in allowed_frequencies:
            raise ValueError(f"Invalid frequency: {frequency}")
    return species, campaign, mode, site, hub, receiver, frequency_values


@lru_cache(maxsize=96)
def weighted_raster(
    species: str,
    campaign: str,
    mode: str,
    site: str,
    hub: str,
    receiver: str,
    frequencies: tuple[float, ...],
) -> tuple[np.ma.MaskedArray, dict]:
    if mode == "overall":
        return read_band(overall_path(site, hub, receiver))

    selected_frequencies = frequencies
    if mode == "frequency":
        if len(selected_frequencies) != 1:
            raise ValueError("Select exactly one frequency.")
    elif mode == "broadband":
        selected_frequencies = tuple(freq for freq in OPTIONS["frequencies"] if 25 <= freq <= 10000)
    elif mode == "multi":
        if not selected_frequencies:
            raise ValueError("Select at least one frequency.")

    weighted_layers: list[np.ma.MaskedArray] = []
    profile = None
    for frequency in selected_frequencies:
        layer, profile = read_band(frequency_path(site, frequency, hub, receiver))
        weighted_layers.append(layer + equalizer_gain(species, campaign, frequency))

    if mode == "frequency":
        return weighted_layers[0], profile or {}
    return combine_energy(weighted_layers), profile or {}


def raster_stats(array: np.ma.MaskedArray, profile: dict) -> dict:
    if array.count() == 0:
        raise ValueError("Raster has no valid values.")
    bounds = transform_bounds(profile["crs"], "EPSG:4326", *rasterio.transform.array_bounds(profile["height"], profile["width"], profile["transform"]), densify_pts=21)
    return {
        "min": float(array.min()),
        "max": float(array.max()),
        "bounds": {
            "west": bounds[0],
            "south": bounds[1],
            "east": bounds[2],
            "north": bounds[3],
        },
    }


def jet_color(normalized: np.ndarray) -> np.ndarray:
    x = np.clip(normalized, 0, 1)
    red = np.clip(1.5 - np.abs(4 * x - 3), 0, 1)
    green = np.clip(1.5 - np.abs(4 * x - 2), 0, 1)
    blue = np.clip(1.5 - np.abs(4 * x - 1), 0, 1)
    return np.stack([red, green, blue], axis=-1)


def png_bytes(array: np.ma.MaskedArray) -> bytes:
    min_value = float(array.min())
    max_value = float(array.max())
    span = max(max_value - min_value, 1e-6)
    normalized = (array.filled(min_value) - min_value) / span
    rgb = (jet_color(normalized) * 255).astype("uint8")
    alpha = (~np.ma.getmaskarray(array) * 245).astype("uint8")
    rgba = np.dstack([rgb, alpha])
    image = Image.fromarray(rgba, mode="RGBA")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def tiff_bytes(array: np.ma.MaskedArray, profile: dict) -> bytes:
    output_profile = profile.copy()
    output_profile.update(driver="GTiff", count=1, dtype="float32", nodata=-9999.0, compress="deflate")
    with MemoryFile() as memory_file:
        with memory_file.open(**output_profile) as dataset:
            dataset.write(array.filled(-9999.0).astype("float32"), 1)
        return memory_file.read()


class WindMapHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        requested = (ROOT / (parsed.path.lstrip("/") or "index.html")).resolve()
        if requested == ROOT or ROOT in requested.parents:
            return str(requested)
        return str(ROOT / "index.html")

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, payload: bytes, content_type: str, filename: str | None = None) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def api_error(self, exc: Exception) -> None:
        body = str(exc).encode("utf-8")
        self.send_response(HTTPStatus.BAD_REQUEST)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/map-options":
            self.send_json(OPTIONS)
            return
        if parsed.path.startswith("/api/"):
            try:
                query = parse_qs(parsed.query)
                species, campaign, mode, site, hub, receiver, frequencies = parse_request(query)
                array, profile = weighted_raster(species, campaign, mode, site, hub, receiver, frequencies)
                if parsed.path == "/api/render_meta":
                    self.send_json(raster_stats(array, profile))
                    return
                if parsed.path == "/api/render_png":
                    self.send_bytes(png_bytes(array), "image/png")
                    return
                if parsed.path == "/api/download_tiff":
                    freq_label = "broadband" if mode in {"broadband", "overall"} else "_".join(frequency_to_text(freq) for freq in frequencies)
                    filename = f"{species}_{site}_{hub}_{receiver}_{mode}_{freq_label}_weighted.tif"
                    self.send_bytes(tiff_bytes(array, profile), "image/tiff", filename)
                    return
            except Exception as exc:
                self.api_error(exc)
                return
        return super().do_GET()

    def guess_type(self, path: str) -> str:
        if path.endswith(".js"):
            return "application/javascript"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"


def main() -> None:
    port = 5500
    server = ThreadingHTTPServer(("127.0.0.1", port), WindMapHandler)
    print(f"Serving hearing-threshold website and wind-map API at http://127.0.0.1:{port}/")
    print(f"Using wind-map outputs from {OUTPUT_ROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
