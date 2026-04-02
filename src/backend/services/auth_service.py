import functools
import logging
import time

import msal
from flask import request, jsonify, g

from config import Config

logger = logging.getLogger(__name__)


def get_msal_app():
    return msal.ConfidentialClientApplication(
        Config.ENTRA_CLIENT_ID,
        authority=Config.ENTRA_AUTHORITY,
        client_credential=Config.ENTRA_CLIENT_SECRET,
    )


def get_graph_token_obo(user_access_token: str) -> str:
    """Exchange user token for Graph API token via OBO flow."""
    cca = get_msal_app()
    result = cca.acquire_token_on_behalf_of(
        user_assertion=user_access_token,
        scopes=["https://graph.microsoft.com/.default"],
    )
    if "access_token" not in result:
        raise ValueError(f"OBO token acquisition failed: {result.get('error_description', 'Unknown error')}")
    return result["access_token"]


def require_auth(f):
    """Decorator to require Bearer token and exchange it via OBO."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        user_token = auth_header.split(" ", 1)[1]
        try:
            graph_token = get_graph_token_obo(user_token)
        except Exception as e:
            logger.error("OBO token exchange failed: %s", e)
            return jsonify({"error": "Authentication failed"}), 401
        g.graph_token = graph_token
        g.user_token = user_token
        return f(*args, **kwargs)
    return decorated


def retry_with_backoff(func, max_retries=3, base_delay=1.0, retryable_statuses=None):
    """Execute a function with exponential backoff retry."""
    if retryable_statuses is None:
        retryable_statuses = {429, 503, 504}
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            return func()
        except Exception as e:
            last_exception = e
            status = getattr(e, "status_code", None) or getattr(e, "code", None)
            if attempt < max_retries and (status in retryable_statuses or status is None):
                delay = base_delay * (2 ** attempt)
                logger.warning("Retry %d/%d after %.1fs: %s", attempt + 1, max_retries, delay, e)
                time.sleep(delay)
            else:
                break
    raise last_exception
