import logging

from flask import Blueprint, jsonify

from services.auth_service import require_auth
from services import graph_service

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/me", methods=["GET"])
@require_auth
def get_me():
    """Get current user info."""
    try:
        user = graph_service.get_me()
        return jsonify({
            "displayName": user.get("displayName", ""),
            "mail": user.get("mail", ""),
            "id": user.get("id", ""),
        })
    except Exception as e:
        logger.error("Failed to get user info: %s", e)
        return jsonify({"error": "Failed to get user info"}), 500
