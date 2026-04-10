import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, current_app

from services.auth_service import require_auth
from services import graph_service
from services import agent_service
from services.embedding_service import vectorize_document

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
                        "webUrl": item.get("webUrl", ""),
                    }
                    # Backfill fileName/webUrl to Cosmos if missing
                    if not doc.get("fileName") or not doc.get("webUrl"):
                        updated = False
                        if not doc.get("fileName") and file_meta["fileName"]:
                            doc["fileName"] = file_meta["fileName"]
                            updated = True
                        if not doc.get("webUrl") and file_meta["webUrl"]:
                            doc["webUrl"] = file_meta["webUrl"]
                            updated = True
                        if updated:
                            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                            cosmos.upsert_document(doc)
                except Exception as e:
                    logger.warning("Could not get file metadata from Graph: %s", e)

        return jsonify({
            "id": doc["id"],
            "channelId": doc.get("channelId", ""),
            **file_meta,
            "analysis": doc.get("analysis"),
            "processingStatus": doc.get("processingStatus"),
            "processingError": doc.get("processingError"),
            "followUpQuestions": doc.get("followUpQuestions", []),
            "questionHistory": doc.get("questionHistory", []),
            "documentClassification": doc.get("documentClassification"),
            "relationships": doc.get("relationships", []),
            "relationshipStatus": doc.get("relationshipStatus"),
            "relationshipError": doc.get("relationshipError"),
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
        lang = request.json.get("lang", "en") if request.json else "en"
        questions = agent_service.generate_questions(
            extracted_text, lang=lang, figures=analysis.get("figures", [])
        )

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
    lang = data.get("lang", "en")

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
            _try_vectorize(doc, doc_id, cosmos)
            return jsonify({
                "validation": "sufficient",
                "feedback": "Thank you for your detailed responses. Your input has been recorded.",
            })

        # Analyze the answer with the agent
        try:
            validation = agent_service.analyze_answer(
                question_obj["question"], answer_text, lang=lang
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
            _try_vectorize(doc, doc_id, cosmos)

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


def _try_vectorize(doc: dict, doc_id: str, cosmos) -> None:
    """Check if all questions are completed and trigger vectorization if so."""
    all_completed = all(
        q.get("agentValidation") == "sufficient"
        or len([m for m in q.get("conversationThread", [])
                 if m.get("role") == "user"]) >= 3
        for q in doc.get("followUpQuestions", [])
    )

    if not all_completed:
        return

    try:
        doc = vectorize_document(doc)
        doc["vectorizedAt"] = datetime.now(timezone.utc).isoformat()
        cosmos.upsert_document(doc)
        logger.info("Document %s vectorized successfully", doc_id)
    except Exception as ve:
        logger.error("Vectorization failed for %s: %s", doc_id, ve)


@document_bp.route("/documents/<doc_id>/questions/<q_id>/answer", methods=["PUT"])
@require_auth
def update_answer(doc_id, q_id):
    """Update an existing answer to a follow-up question and re-vectorize."""
    data = request.json
    if not data:
        return jsonify({"error": "Request body required"}), 400

    channel_id = data.get("channelId")
    new_answer = data.get("answer", "")
    answered_by = data.get("answeredBy", "")

    if not channel_id or not new_answer:
        return jsonify({"error": "channelId and answer are required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        question_obj = None
        for q in doc.get("followUpQuestions", []):
            if q["questionId"] == q_id:
                question_obj = q
                break

        if not question_obj:
            return jsonify({"error": "Question not found"}), 404

        now = datetime.now(timezone.utc)

        # Update the latest answer
        question_obj["answer"] = new_answer
        question_obj["answeredBy"] = answered_by
        question_obj["answeredAt"] = now.isoformat()
        question_obj["status"] = "answered"

        # Replace the last user message in conversation thread, or append
        thread = question_obj.get("conversationThread", [])
        last_user_idx = None
        for i in range(len(thread) - 1, -1, -1):
            if thread[i].get("role") == "user":
                last_user_idx = i
                break

        if last_user_idx is not None:
            thread[last_user_idx]["text"] = new_answer
            thread[last_user_idx]["timestamp"] = now.isoformat()
            thread[last_user_idx]["answeredBy"] = answered_by
            thread[last_user_idx]["edited"] = True
        else:
            thread.append({
                "role": "user",
                "text": new_answer,
                "timestamp": now.isoformat(),
                "answeredBy": answered_by,
                "edited": True,
            })

        question_obj["conversationThread"] = thread
        doc["updatedInDbAt"] = now.isoformat()
        cosmos.upsert_document(doc)

        # Re-vectorize since answer content changed
        try:
            doc = vectorize_document(doc)
            doc["vectorizedAt"] = now.isoformat()
            cosmos.upsert_document(doc)
            logger.info("Document %s re-vectorized after answer update", doc_id)
        except Exception as ve:
            logger.error("Re-vectorization failed for %s: %s", doc_id, ve)

        return jsonify({"status": "updated", "question": question_obj})

    except Exception as e:
        logger.error("Failed to update answer: %s", e)
        return jsonify({"error": f"Failed to update answer: {e}"}), 500


@document_bp.route("/documents/<doc_id>/complete-questions", methods=["POST"])
@require_auth
def complete_questions(doc_id):
    """Mark the question flow as done and trigger vectorization.
    Called when the user finishes (or skips) all follow-up questions."""
    data = request.json or {}
    channel_id = data.get("channelId")
    if not channel_id:
        return jsonify({"error": "channelId is required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        if doc.get("contentVector"):
            return jsonify({"status": "already_vectorized"})

        doc = vectorize_document(doc)
        doc["vectorizedAt"] = datetime.now(timezone.utc).isoformat()
        cosmos.upsert_document(doc)
        logger.info("Document %s vectorized on question completion", doc_id)

        return jsonify({"status": "vectorized"})

    except Exception as e:
        logger.error("Vectorization on complete failed for %s: %s", doc_id, e)
        return jsonify({"error": f"Vectorization failed: {e}"}), 500


@document_bp.route("/documents/<doc_id>", methods=["DELETE"])
@require_auth
def delete_document(doc_id):
    """Delete a document from SharePoint and Cosmos DB, and clean up
    relationship references in related documents."""
    channel_id = request.args.get("channelId")
    if not channel_id:
        return jsonify({"error": "channelId query parameter required"}), 400

    cosmos = current_app.config["COSMOS_SERVICE"]

    try:
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return jsonify({"error": "Document not found"}), 404

        # 1. Delete the file from SharePoint via Graph API
        drive_item_path = doc.get("driveItemPath", "")
        if drive_item_path:
            parts = drive_item_path.strip("/").split("/")
            if len(parts) >= 4:
                drive_id = parts[1]
                item_id = parts[3]
                try:
                    graph_service.delete_drive_item(drive_id, item_id)
                    logger.info("Deleted SharePoint file for document %s", doc_id)
                except Exception as e:
                    logger.error("Failed to delete SharePoint file for %s: %s", doc_id, e)
                    return jsonify({"error": f"Failed to delete file from SharePoint: {e}"}), 500

        # 2. Remove relationship references from related documents
        relationships = doc.get("relationships", [])
        cleanup_errors = []
        for rel in relationships:
            target_id = rel.get("targetDocId", "")
            if not target_id:
                continue
            try:
                target_doc = cosmos.get_document(target_id, channel_id)
                if not target_doc:
                    continue
                original_count = len(target_doc.get("relationships", []))
                target_doc["relationships"] = [
                    r for r in target_doc.get("relationships", [])
                    if r.get("targetDocId") != doc_id
                ]
                if len(target_doc["relationships"]) < original_count:
                    target_doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                    cosmos.upsert_document(target_doc)
                    logger.info("Removed relationship to %s from document %s", doc_id, target_id)
            except Exception as e:
                logger.error("Failed to clean relationship in %s: %s", target_id, e)
                cleanup_errors.append(target_id)

        # 3. Delete the document itself from Cosmos DB
        cosmos.delete_document(doc_id, channel_id)
        logger.info("Deleted document %s from Cosmos DB", doc_id)

        result = {"status": "deleted", "documentId": doc_id}
        if cleanup_errors:
            result["warnings"] = f"Failed to clean relationships in: {', '.join(cleanup_errors)}"

        return jsonify(result)

    except Exception as e:
        logger.error("Failed to delete document %s: %s", doc_id, e)
        return jsonify({"error": f"Failed to delete document: {e}"}), 500
