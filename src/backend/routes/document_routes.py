import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, current_app

from services.auth_service import require_auth
from services import graph_service
from services import agent_service

logger = logging.getLogger(__name__)
document_bp = Blueprint("documents", __name__)


@document_bp.route("/documents/<doc_id>", methods=["GET"])
@require_auth
def get_document(doc_id):
    """Get document details from Cosmos DB + Graph API metadata."""
    channel_id = request.args.get("channelId")
    if not channel_id:
        return jsonify({"error": "channelId query parameter required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        # Get file metadata from Graph API
        drive_item_path = doc.get("driveItemPath", "")
        file_meta = {}
        if drive_item_path:
            parts = drive_item_path.strip("/").split("/")
            if len(parts) >= 4:
                drive_id = parts[1]
                item_id = parts[3]
                try:
                    item = graph_service.get_drive_item(drive_id, item_id)
                    file_meta = {
                        "fileName": item.get("name", ""),
                        "createdAt": item.get("createdDateTime", ""),
                        "createdBy": item.get("createdBy", {}).get("user", {}).get("displayName", ""),
                        "lastModifiedAt": item.get("lastModifiedDateTime", ""),
                        "lastModifiedBy": item.get("lastModifiedBy", {}).get("user", {}).get("displayName", ""),
                    }
                except Exception as e:
                    logger.warning("Could not get file metadata from Graph: %s", e)

        return jsonify({
            "id": doc["id"],
            "channelId": doc.get("channelId", ""),
            **file_meta,
            "followUpQuestions": doc.get("followUpQuestions", []),
            "questionHistory": doc.get("questionHistory", []),
        })

    except Exception as e:
        logger.error("Failed to get document: %s", e)
        return jsonify({"error": "Failed to retrieve document"}), 500


@document_bp.route("/documents/<doc_id>/generate-questions", methods=["POST"])
@require_auth
def regenerate_questions(doc_id):
    """Regenerate follow-up questions for an existing document."""
    channel_id = request.json.get("channelId") if request.json else None
    if not channel_id:
        return jsonify({"error": "channelId is required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        analysis = doc.get("analysis")
        if not analysis:
            return jsonify({"error": "No analysis available. Please re-upload the file."}), 400

        extracted_text = analysis.get("extractedText", "")
        questions = agent_service.generate_questions(extracted_text)

        now = datetime.now(timezone.utc)

        # Move existing questions to history
        question_history = doc.get("questionHistory", [])
        if doc.get("followUpQuestions"):
            round_num = len(question_history) + 1
            question_history.append({
                "generationRound": round_num,
                "generatedAt": doc.get("updatedInDbAt", now.isoformat()),
                "questions": doc["followUpQuestions"],
            })

        follow_up = []
        for q in questions:
            follow_up.append({
                "questionId": q.get("questionId", ""),
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
        doc["questionHistory"] = question_history
        doc["updatedInDbAt"] = now.isoformat()
        cosmos.upsert_document(doc)

        return jsonify({"followUpQuestions": follow_up})

    except Exception as e:
        logger.error("Question generation failed: %s", e)
        return jsonify({"error": f"Question generation failed: {e}"}), 500


@document_bp.route("/documents/<doc_id>/questions/<q_id>/answer", methods=["POST"])
@require_auth
def answer_question(doc_id, q_id):
    """Submit and analyze an answer to a follow-up question."""
    data = request.json
    if not data:
        return jsonify({"error": "Request body required"}), 400

    channel_id = data.get("channelId")
    answer_text = data.get("answer", "")
    answered_by = data.get("answeredBy", "")

    if not channel_id or not answer_text:
        return jsonify({"error": "channelId and answer are required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        # Find the question
        question_obj = None
        for q in doc.get("followUpQuestions", []):
            if q["questionId"] == q_id:
                question_obj = q
                break

        if not question_obj:
            return jsonify({"error": "Question not found"}), 404

        now = datetime.now(timezone.utc)

        # Initialize conversation thread if not present
        if "conversationThread" not in question_obj:
            question_obj["conversationThread"] = []

        # Append this answer to the conversation thread
        question_obj["conversationThread"].append({
            "role": "user",
            "text": answer_text,
            "timestamp": now.isoformat(),
            "answeredBy": answered_by,
        })

        # Save latest answer as the primary answer
        question_obj["answer"] = answer_text
        question_obj["answeredBy"] = answered_by
        question_obj["answeredAt"] = now.isoformat()
        question_obj["status"] = "answered"
        doc["updatedInDbAt"] = now.isoformat()
        cosmos.upsert_document(doc)

        # Check if max follow-up rounds reached (3 rounds)
        user_messages = [m for m in question_obj["conversationThread"] if m["role"] == "user"]
        if len(user_messages) >= 3:
            question_obj["agentValidation"] = "sufficient"
            question_obj["conversationThread"].append({
                "role": "assistant",
                "text": "Thank you for your detailed responses. Your input has been recorded.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            cosmos.upsert_document(doc)
            return jsonify({
                "validation": "sufficient",
                "feedback": "Thank you for your detailed responses. Your input has been recorded.",
            })

        # Analyze the answer with the agent
        try:
            validation = agent_service.analyze_answer(
                question_obj["question"], answer_text
            )
            question_obj["agentValidation"] = validation.get("validation", "sufficient")

            # Save AI feedback to conversation thread
            if "conversationThread" not in question_obj:
                question_obj["conversationThread"] = []
            question_obj["conversationThread"].append({
                "role": "assistant",
                "text": validation.get("feedback", ""),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "validation": validation.get("validation", "sufficient"),
            })
            cosmos.upsert_document(doc)

            return jsonify({
                "validation": validation.get("validation", "sufficient"),
                "feedback": validation.get("feedback", ""),
            })
        except Exception as e:
            logger.error("Answer analysis failed: %s", e)
            return jsonify({
                "validation": "error",
                "feedback": f"Answer analysis temporarily unavailable: {e}. Your answer has been saved. Please try again.",
            }), 207

    except Exception as e:
        logger.error("Failed to submit answer: %s", e)
        return jsonify({"error": f"Failed to submit answer: {e}"}), 500
