import datetime as dt
import json

from xearth_clouds import ionosphere


def point(lon, lat, tec, anomaly):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {"tec": tec, "anomaly": anomaly, "hmF2": 300.0, "NmF2": 1e11, "quality_flag": 0}}


# GloTEC's order: south row first, west to east (as served on 2026-10-23).
FRAME = {
    "type": "FeatureCollection",
    "time_tag": "2026-10-23T01:55:00Z",
    "cadence": 10,
    "features": [
        point(-177.5, -88.75, 3.94, -0.18),
        point(-172.5, -88.75, 4.0, 0.0),
        point(-177.5, -86.25, 70.84, 18.3),
        point(-172.5, -86.25, 12.0, -6.7),
    ],
}
INDEX = [
    {"url": "/products/glotec/geojson_2d_urt/glotec_icao_20261023T014500Z.geojson", "time_tag": "2026-10-23T01:45:00Z"},
    {"url": "/products/glotec/geojson_2d_urt/glotec_icao_20261023T015500Z.geojson", "time_tag": "2026-10-23T01:55:00Z"},
    {"url": "/products/glotec/geojson_2d_urt/glotec_icao_20261023T015000Z.geojson", "time_tag": "2026-10-23T01:50:00Z"},
]


def test_newest_frame_by_time():
    assert ionosphere.newest_frame(INDEX)["time_tag"] == "2026-10-23T01:55:00Z"


def test_grid_is_north_up_in_tenths():
    g = ionosphere.grid(FRAME["features"])
    assert (g["nlon"], g["nlat"], g["lon0"], g["lat0"], g["dlon"], g["dlat"]) == (2, 2, -177.5, -86.25, 5.0, -2.5)
    # North row first: -86.25 then -88.75.
    assert g["tec"] == [708, 120, 39, 40]
    assert g["anomaly"] == [183, -67, -2, 0]


def test_build_reads_the_newest_frame():
    calls = []

    def get(url):
        calls.append(url)
        return json.dumps(INDEX if url == ionosphere.INDEX else FRAME)

    m = ionosphere.build(get, now=dt.datetime(2026, 10, 23, 2, 50, tzinfo=dt.timezone.utc))
    assert calls[1] == ionosphere.SWPC + "/products/glotec/geojson_2d_urt/glotec_icao_20261023T015500Z.geojson"
    assert m["time"] == "2026-10-23T01:55:00Z"
    assert m["tecMax"] == 70.8
    assert m["source"] == "NOAA SWPC GloTEC"
