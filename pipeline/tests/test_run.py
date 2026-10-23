import datetime as dt
import json
import subprocess

import pytest

from xearth_clouds import run

UTC = dt.timezone.utc


def test_jobs_follow_the_deploy_order_with_clouds_last():
    names = [j[0] for j in run.JOBS]
    assert names[-1] == "clouds"  # reads the textures, and is the one layer everything needs
    assert set(names) == {"satellites", "launches", "storms", "fires", "lightning", "events", "snowice", "smoke", "tsunami", "meteoalarm", "ionosphere", "meteors", "buoys", "clouds"}


def test_next_run_is_the_next_hh50():
    assert run.next_run(dt.datetime(2026, 10, 21, 22, 10, tzinfo=UTC), 50) == dt.datetime(2026, 10, 21, 22, 50, tzinfo=UTC)
    assert run.next_run(dt.datetime(2026, 10, 21, 22, 50, tzinfo=UTC), 50) == dt.datetime(2026, 10, 21, 23, 50, tzinfo=UTC)
    assert run.next_run(dt.datetime(2026, 10, 21, 23, 55, tzinfo=UTC), 50) == dt.datetime(2026, 10, 22, 0, 50, tzinfo=UTC)


def test_skip_list():
    assert run.parse_skip(" Lightning, smoke ") == {"lightning", "smoke"}
    assert run.parse_skip("") == set()
    with pytest.raises(SystemExit):
        run.parse_skip("lighting")


def test_a_failing_job_doesnt_stop_the_rest(tmp_path):
    calls = []

    def fake_run(cmd, timeout):
        module = cmd[2]
        calls.append(module)
        if module == "xearth_clouds.storms":
            return subprocess.CompletedProcess(cmd, 1)
        if module == "xearth_clouds.fires":
            raise subprocess.TimeoutExpired(cmd, timeout)
        assert cmd[3:] == ["--out", str(tmp_path / cmd[2].split(".")[-1].replace("xearth_clouds", "clouds"))]
        return subprocess.CompletedProcess(cmd, 0)

    status = run.run_once(tmp_path, {"lightning"}, run=fake_run)
    assert "xearth_clouds.lightning" not in calls
    assert calls[-1] == "xearth_clouds"
    assert status["jobs"]["storms"] == {"ok": False, "seconds": status["jobs"]["storms"]["seconds"], "error": "exit 1"}
    assert status["jobs"]["fires"]["error"].startswith("timed out")
    assert status["jobs"]["lightning"] == {"ok": None, "skipped": True}
    assert status["jobs"]["clouds"]["ok"] is True
    assert json.loads((tmp_path / "status.json").read_text())["jobs"]["clouds"]["ok"] is True


def test_healthcheck(tmp_path):
    now = dt.datetime(2026, 10, 21, 23, 0, tzinfo=UTC)
    assert run.healthy(tmp_path, now)[0] is False  # nothing yet
    status = {"started": "2026-10-21T22:50:00Z", "finished": "2026-10-21T22:53:10Z", "jobs": {"clouds": {"ok": True}, "storms": {"ok": False}}}
    (tmp_path / "status.json").write_text(json.dumps(status))
    ok, why = run.healthy(tmp_path, now)
    assert ok and "failed: storms" in why
    assert run.healthy(tmp_path, now + dt.timedelta(hours=3))[0] is False
