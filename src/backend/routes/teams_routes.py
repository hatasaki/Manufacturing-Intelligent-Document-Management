import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, current_app

from services.auth_service import require_auth
from services import graph_service
from services import content_understanding_service
from services import agent_service

logger = logging.getLogger(__name__)
teams_bp = Blueprint("teams", __name__)

FOUR_MB = 4 * 1024 * 1024


@teams_bp.route("/teams/channels", methods=["GET"])
@require_auth
def get_channels():
    """Get all teams and channels the user has access to."""
    try:
        teams = graph_service.get_joined_teams()
        result = []
        for team in teams:
            team_id = team["id"]
            team_name = team.get("displayName", "")
            channels = graph_service.get_team_channels(team_id)
            for ch in channels:
                result.append({
                    "teamId": team_id,
                    "teamName": team_name,
                    "channelId": ch["id"],
                    "channelName": ch.get("displayName", ""),
                })
        return jsonify(result)
    except Exception as e:
        logger.error("Failed to get channels: %s", e)
        return jsonify({"error": "Failed to retrieve channels"}), 500


@teams_bp.route("/teams/<team_id>/channels/<channel_id>/files", methods=["GET"])
@require_auth
def get_channel_files(team_id, channel_id):
    """List files in a Teams channel's SharePoint folder."""
    try:
        folder = graph_service.get_channel_files_folder(team_id, channel_id)
        drive_id = folder["parentReference"]["driveId"]
        folder_id = folder["id"]
        items = graph_service.get_drive_children(drive_id, folder_id)

        cosmos = current_app.config["COSMOS_SERVICE"]

        files = []
        for item in items:
            if item.get("file"):
                drive_item_id = item["id"]
                doc = cosmos.find_by_drive_item_id(channel_id, drive_item_id)
                files.append({
                    "name": item.get("name", ""),
                    "size": item.get("size", 0),
                    "lastModifiedDateTime": item.get("lastModifiedDateTime", ""),
                    "driveItemId": drive_item_id,
                    "driveId": drive_id,
                    "docId": doc["id"] if doc else None,
                })
        return jsonify(files)
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        return jsonify({"error": f"Failed to list files: {e}"}), 500


@teams_bp.route("/teams/<team_id>/channels/<channel_id>/files", methods=["POST"])
@require_auth
def upload_file(team_id, channel_id):
    """Upload a file to the Teams channel's SharePoint and analyze it."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    file_content = file.read()
    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        # 1. Get channel files folder
        folder = graph_service.get_channel_files_folder(team_id, channel_id)
        drive_id = folder["parentReference"]["driveId"]
        folder_id = folder["id"]
        site_id = folder["parentReference"].get("siteId", "")

        # 2. Upload to SharePoint
        if len(file_content) < FOUR_MB:
            uploaded = graph_service.upload_small_file(
                drive_id, folder_id, file.filename, file_content
            )
        else:
            uploaded = graph_service.upload_large_file(
                drive_id, folder_id, file.filename, file_content
            )

        drive_item_id = uploaded["id"]
        drive_item_path = f"/drives/{drive_id}/items/{drive_item_id}"

        # 3. Generate document identifier
        now = datetime.now(timezone.utc)
        short_id = uuid.uuid4().hex[:8]
        doc_id = f"doc-{now.strftime('%Y%m%d')}-{short_id}"

        # 4. Check if doc already exists (re-upload)
        existing = cosmos.find_by_drive_item_id(channel_id, drive_item_id)
        question_history = []
        if existing:
            doc_id = existing["id"]
            # Move current questions to history
            if existing.get("followUpQuestions"):
                round_num = len(existing.get("questionHistory", [])) + 1
                question_history = existing.get("questionHistory", [])
                question_history.append({
                    "generationRound": round_num,
                    "generatedAt": existing.get("updatedInDbAt", now.isoformat()),
                    "questions": existing["followUpQuestions"],
                })

        # 5. Set custom field on SharePoint
        try:
            graph_service.set_custom_field(drive_id, drive_item_id, "DocIdentifier", doc_id)
        except Exception as e:
            logger.warning("Could not set custom field: %s", e)

        # 6. Analyze with Content Understanding
        try:
            analysis = content_understanding_service.analyze_document(file_content)
            analysis["analyzedAt"] = now.isoformat()
        except Exception as e:
            logger.error("Content Understanding analysis failed: %s", e, exc_info=True)
            # Save partial result
            doc = {
                "id": doc_id,
                "channelId": channel_id,
                "siteId": site_id,
                "driveItemId": drive_item_id,
                "driveItemPath": drive_item_path,
                "analysis": None,
                "followUpQuestions": [],
                "questionHistory": question_history,
                "relatedDocuments": [],
                "version": 1,
                "createdInDbAt": now.isoformat(),
                "updatedInDbAt": now.isoformat(),
            }
            cosmos.upsert_document(doc)
            return jsonify({
                "error": f"Analysis failed: {type(e).__name__}: {e}",
                "docId": doc_id,
                "partialSuccess": True,
                "message": f"File uploaded successfully. Analysis failed: {type(e).__name__}: {e}",
            }), 207

        # 7. Save analysis to Cosmos DB
        doc = {
            "id": doc_id,
            "channelId": channel_id,
            "siteId": site_id,
            "driveItemId": drive_item_id,
            "driveItemPath": drive_item_path,
            "analysis": analysis,
            "followUpQuestions": [],
            "questionHistory": question_history,
            "relatedDocuments": [],
            "version": 1,
            "createdInDbAt": now.isoformat(),
            "updatedInDbAt": now.isoformat(),
        }
        cosmos.upsert_document(doc)

        # 8. Generate follow-up questions
        try:
            extracted_text = analysis.get("extractedText", "")
            lang = request.form.get("lang", "en")
            questions = agent_service.generate_questions(extracted_text, lang=lang)
            follow_up = []
            for q in questions:
                follow_up.append({
                    "questionId": q.get("questionId", f"q-{uuid.uuid4().hex[:3]}"),
                    "question": q.get("question", ""),
                    "perspective": q.get("perspective", ""),
                    "generatedAt": now.isoformat(),
                    "status": "pending",
                    "answeredBy": None,
                    "answeredAt": None,
                    "answer": None,
                    "agentValidation": None,
                })
            doc["followUpQuestions"] = follow_up
            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
            cosmos.upsert_document(doc)
        except Exception as e:
            logger.error("Question generation failed: %s", e)
            return jsonify({
                "docId": doc_id,
                "partialSuccess": True,
                "message": f"Question generation failed: {e}. The file has been uploaded successfully. You can retry question generation later.",
                "followUpQuestions": [],
            }), 207

        return jsonify({
            "docId": doc_id,
            "followUpQuestions": doc["followUpQuestions"],
        }), 201

    except Exception as e:
        logger.error("Upload failed: %s", e)
        return jsonify({"error": f"Upload failed: {e}"}), 500
