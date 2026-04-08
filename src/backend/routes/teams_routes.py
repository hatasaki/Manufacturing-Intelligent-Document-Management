import logging
import uuid
import threading
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
                    "webUrl": item.get("webUrl", ""),
                })
        return jsonify(files)
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        return jsonify({"error": f"Failed to list files: {e}"}), 500


@teams_bp.route("/teams/<team_id>/channels/<channel_id>/files", methods=["POST"])
@require_auth
def upload_file(team_id, channel_id):
    """Upload a file to the Teams channel's SharePoint and start async analysis."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    file_content = file.read()
    lang = request.form.get("lang", "en")
    deep_analysis = request.form.get("deepAnalysis", "false").lower() == "true"
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

        # 6. Save initial doc to Cosmos with processing status
        doc = {
            "id": doc_id,
            "channelId": channel_id,
            "siteId": site_id,
            "driveItemId": drive_item_id,
            "driveItemPath": drive_item_path,
            "fileName": file.filename,
            "webUrl": uploaded.get("webUrl", ""),
            "analysis": None,
            "followUpQuestions": [],
            "questionHistory": question_history,
            "relatedDocuments": [],
            "processingStatus": "analyzing",
            "documentClassification": None,
            "relationships": [],
            "relationshipStatus": None,
            "relationshipError": None,
            "version": 1,
            "createdInDbAt": now.isoformat(),
            "updatedInDbAt": now.isoformat(),
        }
        cosmos.upsert_document(doc)

        # 7. Start background thread for CU analysis + question generation
        app = current_app._get_current_object()
        thread = threading.Thread(
            target=_process_document_background,
            args=(app, doc_id, channel_id, file_content, question_history, lang, deep_analysis),
            daemon=True,
        )
        thread.start()

        return jsonify({
            "docId": doc_id,
            "processingStatus": "analyzing",
        }), 201

    except Exception as e:
        logger.error("Upload failed: %s", e)
        return jsonify({"error": f"Upload failed: {e}"}), 500


def _process_document_background(app, doc_id, channel_id, file_content, question_history, lang, deep_analysis=False):
    """Run Content Understanding analysis and question generation in background."""
    with app.app_context():
        cosmos = app.config["COSMOS_SERVICE"]

        try:
            # Analyze with Content Understanding
            analysis = content_understanding_service.analyze_document(file_content, deep_analysis=deep_analysis)
            analysis["analyzedAt"] = datetime.now(timezone.utc).isoformat()

            doc = cosmos.get_document(doc_id, channel_id)
            if not doc:
                logger.error("Background: doc %s not found", doc_id)
                return

            doc["analysis"] = analysis
            doc["processingStatus"] = "generating_questions"
            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
            cosmos.upsert_document(doc)

        except Exception as e:
            logger.error("Background CU analysis failed for %s: %s", doc_id, e, exc_info=True)
            doc = cosmos.get_document(doc_id, channel_id)
            if doc:
                doc["processingStatus"] = "error"
                doc["processingError"] = f"Analysis failed: {type(e).__name__}: {e}"
                doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                cosmos.upsert_document(doc)
            return

        try:
            # Generate follow-up questions
            extracted_text = analysis.get("extractedText", "")
            questions = agent_service.generate_questions(
                extracted_text, lang=lang, figures=analysis.get("figures", [])
            )
            follow_up = []
            now = datetime.now(timezone.utc)
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

            doc = cosmos.get_document(doc_id, channel_id)
            if not doc:
                return
            doc["followUpQuestions"] = follow_up
            doc["processingStatus"] = "completed"
            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
            cosmos.upsert_document(doc)
            logger.info("Background processing completed for %s", doc_id)

            # Enqueue relationship extraction (sequential via worker thread)
            try:
                from services import relationship_service
                doc = cosmos.get_document(doc_id, channel_id)
                if doc:
                    doc["relationshipStatus"] = "queued"
                    doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                    cosmos.upsert_document(doc)
                relationship_service.enqueue_relationship_extraction(app, doc_id, channel_id)
            except Exception as re:
                logger.error("Failed to enqueue relationship extraction for %s: %s", doc_id, re)

        except Exception as e:
            logger.error("Background question generation failed for %s: %s", doc_id, e)
            doc = cosmos.get_document(doc_id, channel_id)
            if doc:
                doc["processingStatus"] = "completed"
                doc["processingError"] = f"Question generation failed: {e}"
                doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                cosmos.upsert_document(doc)

                # Still enqueue relationship extraction even if questions failed
                try:
                    from services import relationship_service
                    doc["relationshipStatus"] = "queued"
                    cosmos.upsert_document(doc)
                    relationship_service.enqueue_relationship_extraction(app, doc_id, channel_id)
                except Exception as re:
                    logger.error("Failed to enqueue relationship extraction for %s: %s", doc_id, re)
