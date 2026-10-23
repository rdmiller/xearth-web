"""Constants for the xearth web integration."""

from datetime import timedelta

DOMAIN = "xearth"

# The public build (GitHub Pages, redeployed hourly); a self-hosted one works the same.
DEFAULT_URL = "https://rdmiller.github.io/xearth-web/"

CONF_PANEL = "panel"
CONF_PANEL_TITLE = "panel_title"
CONF_PANEL_PARAMS = "panel_params"
DEFAULT_PANEL_TITLE = "Earth"
PANEL_ICON = "mdi:earth"
PANEL_URL_PATH = "xearth"

# The pipeline publishes hourly; quakes and space weather change by the minute.
UPDATE_INTERVAL = timedelta(minutes=5)
REQUEST_TIMEOUT = 30
# A feed that stops answering keeps its last data this long, then its entities go unavailable.
STALE_AFTER = timedelta(hours=3)
