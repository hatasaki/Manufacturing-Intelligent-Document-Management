import logging

import requests
from flask import g

from services.auth_service import retry_with_backoff

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def _headers():
    return {"Authorization": f"Bearer {g.graph_token}", "Content-Type": "application/json"}


def _get(url: str, params: dict = None) -> dict:
    def call():
        resp = requests.get(url, headers=_headers(), params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    return retry_with_backoff(call)


def _put(url: str, data: bytes, headers_override: dict = None) -> dict:
    def call():
        h = headers_override or _headers()
        h["Authorization"] = f"Bearer {g.graph_token}"
        resp = requests.put(url, headers=h, data=data, timeout=60)
        resp.raise_for_status()
        return resp.json()
    return retry_with_backoff(call)


def _post(url: str, json_data: dict = None) -> dict:
    def call():
        resp = requests.post(url, headers=_headers(), json=json_data, timeout=60)
        resp.raise_for_status()
        return resp.json()
    return retry_with_backoff(call)


def _patch(url: str, json_data: dict) -> dict:
    def call():
        resp = requests.patch(url, headers=_headers(), json=json_data, timeout=30)
        resp.raise_for_status()
        return resp.json()
    return retry_with_backoff(call)


def get_me() -> dict:
    return _get(f"{GRAPH_BASE}/me")


def get_joined_teams() -> list:
    data = _get(f"{GRAPH_BASE}/me/joinedTeams")
    return data.get("value", [])


def get_team_channels(team_id: str) -> list:
    data = _get(f"{GRAPH_BASE}/teams/{team_id}/channels")
    return data.get("value", [])


def get_channel_files_folder(team_id: str, channel_id: str) -> dict:
    return _get(f"{GRAPH_BASE}/teams/{team_id}/channels/{channel_id}/filesFolder")


def get_drive_children(drive_id: str, folder_id: str) -> list:
    data = _get(f"{GRAPH_BASE}/drives/{drive_id}/items/{folder_id}/children")
    return data.get("value", [])


def upload_small_file(drive_id: str, folder_id: str, file_name: str, content: bytes) -> dict:
    url = f"{GRAPH_BASE}/drives/{drive_id}/items/{folder_id}:/{file_name}:/content"
    return _put(url, content, {"Content-Type": "application/octet-stream"})


def upload_large_file(drive_id: str, folder_id: str, file_name: str, content: bytes) -> dict:
    session_url = f"{GRAPH_BASE}/drives/{drive_id}/items/{folder_id}:/{file_name}:/createUploadSession"
    session = _post(session_url, {"item": {"@microsoft.graph.conflictBehavior": "replace"}})
    upload_url = session["uploadUrl"]

    chunk_size = 3_276_800  # 3.125 MB
    total_size = len(content)
    uploaded_item = None

    for start in range(0, total_size, chunk_size):
        end = min(start + chunk_size, total_size) - 1
        chunk = content[start:end + 1]
        headers = {
            "Content-Length": str(len(chunk)),
            "Content-Range": f"bytes {start}-{end}/{total_size}",
        }
        resp = requests.put(upload_url, headers=headers, data=chunk, timeout=120)
        resp.raise_for_status()
        if resp.status_code in (200, 201):
            uploaded_item = resp.json()

    return uploaded_item


def set_custom_field(drive_id: str, item_id: str, field_name: str, field_value: str) -> dict:
    url = f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/listItem/fields"
    return _patch(url, {field_name: field_value})


def get_drive_item(drive_id: str, item_id: str) -> dict:
    return _get(f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}")
