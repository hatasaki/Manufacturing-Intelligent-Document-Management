import logging

from flask import Blueprint, jsonify, request, current_app

from services.auth_service import require_auth
from services import graph_service

logger = logging.getLogger(__name__)
relationship_bp = Blueprint("relationships", __name__)


@relationship_bp.route("/documents/<doc_id>/relationships", methods=["GET"])
@require_auth
def get_relationships(doc_id):
    """Get document relationships with enriched target metadata."""
    channel_id = request.args.get("channelId")
    if not channel_id:
        return jsonify({"error": "channelId query parameter required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        status = doc.get("relationshipStatus")
        classification = doc.get("documentClassification")
        raw_relationships = doc.get("relationships", [])

        # Enrich relationships with target document metadata
        enriched = []
        for rel in raw_relationships:
            target_id = rel.get("targetDocId", "")
            target_title = "(unknown)"
            target_stage = None
            target_filename = None
            target_web_url = ""

            if target_id:
                target_doc = cosmos.get_document(target_id, channel_id)
                if target_doc:
                    # Get fileName: prefer stored fileName, fallback to Graph API lookup
                    target_filename = target_doc.get("fileName")
                    target_web_url = target_doc.get("webUrl", "")

                    t_cls = target_doc.get("documentClassification")
                    if t_cls:
                        target_title = t_cls.get("title", "(unknown)")
                        target_stage = t_cls.get("stage")

                    # If fileName/webUrl not in Cosmos, fetch from Graph API via driveItemPath
                    if not target_filename or not target_web_url:
                        drive_item_path = target_doc.get("driveItemPath", "")
                        if drive_item_path:
                            parts = drive_item_path.strip("/").split("/")
                            if len(parts) >= 4:
                                try:
                                    item = graph_service.get_drive_item(parts[1], parts[3])
                                    if not target_filename:
                                        target_filename = item.get("name", "")
                                    if not target_web_url:
                                        target_web_url = item.get("webUrl", "")
                                    # Backfill to Cosmos so future calls don't need Graph API
                                    updated = False
                                    if not target_doc.get("fileName") and target_filename:
                                        target_doc["fileName"] = target_filename
                                        updated = True
                                    if not target_doc.get("webUrl") and target_web_url:
                                        target_doc["webUrl"] = target_web_url
                                        updated = True
                                    if updated:
                                        from datetime import datetime, timezone
                                        target_doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                                        cosmos.upsert_document(target_doc)
                                except Exception as e:
                                    logger.warning("Could not get Graph metadata for %s: %s", target_id, e)

            enriched.append({
                "targetDocId": target_id,
                "targetTitle": target_title,
                "targetStage": target_stage,
                "targetFileName": target_filename or target_title,
                "targetWebUrl": target_web_url,
                "relationshipType": rel.get("relationshipType", ""),
                "confidence": rel.get("confidence", ""),
                "reason": rel.get("reason", ""),
            })

        return jsonify({
            "docId": doc_id,
            "documentClassification": classification,
            "relationships": enriched,
            "relationshipStatus": status,
            "relationshipError": doc.get("relationshipError"),
        })

    except Exception as e:
        logger.error("Failed to get relationships for %s: %s", doc_id, e)
        return jsonify({"error": "Failed to retrieve relationships"}), 500
