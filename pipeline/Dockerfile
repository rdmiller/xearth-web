# The data pipeline: every layer's job into /data, then again each hour (see xearth_clouds/run.py).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml ./
COPY xearth_clouds ./xearth_clouds
RUN pip install .

# Run unprivileged; /data is the shared volume (the compose file's textures step hands it over).
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin xearth \
 && mkdir /data && chown xearth /data
USER xearth

# Healthy once a run has finished within the last two hours (the first run takes a few minutes).
HEALTHCHECK --interval=5m --timeout=20s --start-period=30m \
  CMD ["python", "-m", "xearth_clouds.run", "--data", "/data", "--check"]

CMD ["python", "-m", "xearth_clouds.run", "--data", "/data", "--loop"]
