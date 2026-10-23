import datetime as dt

from xearth_clouds import argo, buoys

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 23, 10, 40, tzinfo=UTC)
START = dt.datetime(2026, 10, 22, 11, tzinfo=UTC)  # 24 whole hours ending with this one

# OSMC's CSV as served on 2026-10-23: header, units row, then rows.
OSMC = """platform_code,platform_type,time,latitude,longitude,observation_depth,sst,atmp,slp,windspd,winddir,wvht
,,UTC,degrees_north,degrees_east,,Deg C,Deg C,hPa,m/s,Deg true,m
46026,MOORED BUOYS (GENERIC),2026-10-22T11:50:00Z,37.75,-122.838,0.0,15.8,NaN,1016.0,5.0,300,1.17
46026,MOORED BUOYS (GENERIC),2026-10-23T09:50:00Z,37.75,-122.838,0.0,16.1,NaN,1015.4,8.0,320,1.93
46026,MOORED BUOYS (GENERIC),2026-10-23T09:50:00Z,37.75,-122.838,5.0,14.0,NaN,NaN,NaN,NaN,NaN
4402591,DRIFTING BUOYS,2026-10-22T12:00:00Z,30.1,-40.2,NaN,24.5,NaN,1018.2,NaN,NaN,NaN
4402591,DRIFTING BUOYS,2026-10-23T08:00:00Z,30.4,-39.9,NaN,24.7,NaN,1017.0,NaN,NaN,NaN
61221,MOORED BUOYS (GENERIC),2026-10-22T10:46:00Z,-42.89,147.338,0.0,NaN,NaN,NaN,NaN,NaN,NaN
99999,VOLUNTEER OBSERVING SHIPS,2026-10-23T08:00:00Z,10,10,NaN,20,NaN,1010,NaN,NaN,NaN
"""
STATIONS = """<stations>
  <station id="46026" lat="37.75" lon="-122.838" elev="0" name="SAN FRANCISCO - 18NM West of San Francisco, CA" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="buoy" met="y" currents="n" waterquality="n" dart="n"/>
  <station id="21415" lat="50.12" lon="171.867" name="ATTU - 175 NM South of Attu, AK" owner="NDBC" pgm="Tsunami" type="dart" met="n" currents="n" waterquality="n" dart="y"/>
  <station id="21413" lat="30.5" lon="152.1" name="SE Tokyo" owner="NDBC" pgm="Tsunami" type="dart" met="n" currents="n" waterquality="n" dart="y"/>
</stations>"""
LATEST_OBS = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
46026    37.750 -122.838 2026 10 23 10 20 320   8.0   9.0  2.3   9  6.2 287     MM    MM    MM    MM    MM   MM     MM
"""
DART = """#YY  MM DD hh mm ss T   HEIGHT
#yr  mo dy hr mn  s -        m
2026 10 23 06 00 00 1 4718.005
2026 10 23 05:45 00 1 9999.000
2026 10 23 05 45 00 1 4718.015
2026 10 23 05 30 00 2 4718.020
2026 10 20 00 00 00 1 4718.100
"""


def get(url):
    if url.startswith(buoys.OSMC):
        return OSMC.encode()
    if url.endswith("activestations.xml"):
        return STATIONS.encode()
    if url.endswith("latest_obs.txt"):
        return LATEST_OBS.encode()
    if url.endswith("21415.dart"):
        return DART.encode()
    raise OSError("404")


def test_asks_osmc_for_buoys_only_with_encoded_operators():
    url = buoys.osmc_url(START)
    assert "time%3E%3D2026-10-22T11%3A00%3A00Z" in url or "time%3E=2026-10-22T11" in url
    assert "platform_type=~" in url and "DRIFTING%20BUOYS" in url and "VOLUNTEER" not in url


def test_reads_surface_reports_of_buoys():
    b = buoys.parse_osmc(OSMC)
    assert set(b) == {"46026", "4402591", "61221"}  # the ship is left out
    assert b["46026"]["type"] == "moored" and len(b["46026"]["reports"]) == 2  # the 5 m reading isn't the surface
    assert b["4402591"]["type"] == "drifting"


def test_latest_hourly_history_and_ndbc_extras():
    manifest, hist, _ = buoys.build(get, now=NOW, workers=1)
    by = {r["id"]: r for r in manifest["buoys"]}
    # 61221 reported nothing but positions; the DART without a file is skipped.
    assert set(by) == {"46026", "4402591", "21415"}
    sf = by["46026"]
    assert sf["name"].startswith("SAN FRANCISCO")
    # NDBC's 10:20 report is newer than OSMC's 09:50, so it wins; gusts and wave period are NDBC's alone.
    assert (sf["time"], sf["wvht"], sf["gust"], sf["dpd"], sf["mwd"], sf["sst"]) == ("2026-10-23T10:20:00.000Z", 2.3, 9.0, 9, 287, 16.1)
    assert hist["series"]["46026"]["wvht"][0] == 1.17 and hist["series"]["46026"]["wvht"][22] == 1.93
    # Drifters keep their track; moorings don't need one.
    assert "lat" in hist["series"]["4402591"] and "lat" not in hist["series"]["46026"]
    dart = by["21415"]
    assert (dart["type"], dart["height"], dart["event"]) == ("dart", 4718.005, True)  # a 1-minute reading: event mode
    # Missing (9999) and older-than-a-day readings are dropped, oldest first.
    assert hist["dart"]["21415"]["height"] == [4718.02, 4718.015, 4718.005]


def test_manifest_counts_types():
    manifest, _, argo_file = buoys.build(get, now=NOW, workers=1)
    # Argo unavailable (the stub 404s everything of its): the rest goes on without it.
    assert manifest["counts"] == {"moored": 1, "drifting": 1, "dart": 1} and argo_file is None
    assert manifest["from"] == "2026-10-22T11:00:00.000Z"


# OSMC's ArgoFloats as served on 2026-10-23: surfacings (distinct()) and binned profiles.
ARGO_POSITIONS = """platform_number,cycle_number,time,latitude,longitude,platform_type,project_name
,,UTC,degrees_north,degrees_east,,
1901514,543,2026-10-05T01:20:00Z,1.5,44.5,APEX,US ARGO PROJECT
1901514,544,2026-10-15T01:23:36Z,1.626,44.64,APEX,US ARGO PROJECT
6990001,12,2026-10-22T22:00:00Z,-40.0,10.0,ARVOR,ARGO FRANCE
"""
ARGO_PROFILES = """platform_number,cycle_number,time,pres,temp,temp_qc,psal,psal_qc
,,UTC,decibar,degree_Celsius,,PSU,
6990001,12,2026-10-22T22:00:00Z,50.0,11.2,1,34.9,1
6990001,12,2026-10-22T22:00:00Z,4.1,12.5,1,34.8,1
6990001,12,2026-10-22T22:00:00Z,100.0,10.1,1,103.9,4
6990001,11,2026-10-12T22:00:00Z,4.0,13.0,1,35.0,1
"""


def with_argo(calls):
    def get_all(url):
        if not url.startswith(argo.ARGO):
            return get(url)
        calls.append(url)
        if "distinct()" in url:
            return ARGO_POSITIONS.encode()
        if "time%3E=2026-10-22T" in url:
            return ARGO_PROFILES.encode()
        raise OSError("HTTP Error 404: Not Found")  # ERDDAP's "no matching results"

    return get_all


def test_argo_queries_encode_operators_and_bin_profiles():
    url = argo.profiles_url(START, NOW)
    assert "time%3E=2026-10-22T11" in url and "time%3C2026-10-23T10" in url and "pres%3C=2000" in url
    assert "orderByClosest(%22platform_number,cycle_number,pres,50%22)" in url


def test_argo_keeps_each_floats_newest_profile_without_bad_values():
    p = argo.parse_profiles(ARGO_PROFILES)
    assert p["6990001"]["cycle"] == 12
    assert p["6990001"]["pres"] == [4, 50, 100]  # shallowest first
    assert p["6990001"]["psal"] == [34.8, 34.9, None]  # flagged bad (4)
    assert argo.surface(p["6990001"]) == (12.5, 34.8)


def test_argo_floats_in_the_manifest_and_their_own_file():
    calls = []
    manifest, _, af = buoys.build(with_argo(calls), now=NOW, workers=1)
    by = {r["id"]: r for r in manifest["buoys"]}
    f = by["6990001"]
    assert (f["type"], f["cycle"], f["model"], f["sst"], f["sal"]) == ("argo", 12, "ARVOR", 12.5, 34.8)
    # A float with no profile in the store still shows where it surfaced.
    assert (by["1901514"]["lat"], by["1901514"]["sst"]) == (1.626, None)
    assert manifest["counts"]["argo"] == 2
    assert af["tracks"]["1901514"]["lat"] == [1.5, 1.626]
    assert set(af["profiles"]) == {"6990001"}
    # No store yet: rebuilt from the last 10 days, a day at a time (plus the positions query).
    assert sum(1 for u in calls if "orderByClosest" in u) == 10


def test_argo_store_carries_over_and_is_pruned():
    old = {"time": "2026-09-01T00:00:00.000Z", "cycle": 1, "pres": [5], "temp": [20.0], "psal": [35.0]}
    kept = {"time": "2026-10-20T00:00:00.000Z", "cycle": 7, "pres": [5], "temp": [21.0], "psal": [35.1]}
    calls = []
    store = {"updated": "2026-10-23T09:40:00.000Z", "profiles": {"1": old, "2": kept}}
    out = argo.update_profiles(with_argo(calls), store, NOW)
    # Only the time since the last run, and the overlap, is fetched.
    assert len(calls) == 1 and "time%3E=2026-10-23T06%3A40%3A00Z" in calls[0]
    assert set(out["profiles"]) == {"2"} and out["updated"] == "2026-10-23T10:40:00.000Z"
