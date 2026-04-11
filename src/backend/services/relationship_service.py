import logging
import queue
import threading
from datetime import datetime, timezone

from services import agent_service
from services.auth_service import retry_with_backoff

logger = logging.getLogger(__name__)

_queue = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()

# Adjacent stage mapping for candidate filtering
ADJACENT_STAGES = {
    "customer_requirements": {"downstream": ["requirements_definition"]},
    "requirements_definition": {"upstream": ["customer_requirements"], "downstream": ["basic_design"]},
    "basic_design": {"upstream": ["requirements_definition"], "downstream": ["detailed_design"]},
    "detailed_design": {"upstream": ["basic_design"], "downstream": ["module_design"]},
    "module_design": {"upstream": ["detailed_design"], "downstream": ["implementation"]},
    "implementation": {"upstream": ["module_design"]},
}

# Reverse relationship mapping for bidirectional save
REVERSE_RELATIONSHIP = {
    "depends_on": "depended_by",
    "depended_by": "depends_on",
    "refers_to": "referred_by",
    "referred_by": "refers_to",
}


def init_worker(app):
    """Recover stuck documents and re-enqueue them on startup."""
    try:
        with app.app_context():
            cosmos = app.config["COSMOS_SERVICE"]
            all_docs = cosmos.query_documents_by_status(
                statuses=["queued", "extracting"]
            )
            for doc in all_docs:
                doc_id = doc["id"]
                channel_id = doc["channelId"]
                logger.info("Recovering stuck relationship extraction for %s", doc_id)
                enqueue_relationship_extraction(app, doc_id, channel_id)
    except Exception as e:
        logger.warning("Startup recovery scan failed: %s", e)


def enqueue_relationship_extraction(app, doc_id: str, channel_id: str) -> None:
    """Enqueue a relationship extraction request. Starts the worker if not running."""
    global _worker_started
    _queue.put((app, doc_id, channel_id))
    with _worker_lock:
        if not _worker_started:
            t = threading.Thread(target=_worker_loop, daemon=True)
            t.start()
            _worker_started = True
            logger.info("Relationship extraction worker thread started")


def _worker_loop():
    """Worker loop: dequeue and process one at a time (sequential)."""
    while True:
        app, doc_id, channel_id = _queue.get()
        try:
            _extract_relationships(app, doc_id, channel_id)
        except Exception as e:
            logger.error("Relationship extraction failed for %s: %s", doc_id, e, exc_info=True)
            # Fallback: ensure status is never left at "extracting"
            try:
                with app.app_context():
                    cosmos = app.config["COSMOS_SERVICE"]
                    doc = cosmos.get_document(doc_id, channel_id)
                    if doc and doc.get("relationshipStatus") == "extracting":
                        doc["relationshipStatus"] = "error"
                        doc["relationshipError"] = f"Unexpected error: {e}"
                        doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                        cosmos.upsert_document(doc)
            except Exception:
                logger.error("Failed to update error status for %s", doc_id, exc_info=True)
        finally:
            _queue.task_done()


def _extract_relationships(app, doc_id: str, channel_id: str) -> None:
    """Main extraction logic, runs inside worker thread."""
    with app.app_context():
        cosmos = app.config["COSMOS_SERVICE"]

        # Update status to extracting
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            logger.error("Relationship extraction: doc %s not found", doc_id)
            return

        doc["relationshipStatus"] = "extracting"
        doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
        cosmos.upsert_document(doc)

        try:
            _do_extraction(cosmos, doc, doc_id, channel_id)
        except Exception as e:
            logger.error("Relationship extraction error for %s: %s", doc_id, e, exc_info=True)
            doc = cosmos.get_document(doc_id, channel_id)
            if doc and doc.get("relationshipStatus") != "completed":
                doc["relationshipStatus"] = "error"
                doc["relationshipError"] = f"Extraction failed: {e}"
                doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
                cosmos.upsert_document(doc)


def _build_classification_text(analysis: dict) -> str:
    """Build text for classification from available analysis data."""
    text = analysis.get("extractedText", "") or ""
    if text:
        return text

    # Fallback: construct text from figures, tables, and key-value pairs
    parts = []
    for fig in (analysis.get("figures") or []):
        desc = fig.get("description", "")
        if desc:
            parts.append(f"Figure: {desc}")
    for kvp in (analysis.get("keyValuePairs") or []):
        k, v = kvp.get("key", ""), kvp.get("value", "")
        if k or v:
            parts.append(f"{k}: {v}")
    for i, tb in enumerate(analysis.get("tables") or []):
        parts.append(f"Table {i+1}: {tb.get('rowCount', 0)} rows × {tb.get('columnCount', 0)} cols")
    return "\n".join(parts)


def _do_extraction(cosmos, doc: dict, doc_id: str, channel_id: str) -> None:
    """Inner extraction logic. Exceptions propagate to caller for status update."""
    # Step 1: Classify document (skip if already classified)
    classification = doc.get("documentClassification")
    if not classification:
        analysis = doc.get("analysis")
        if not analysis:
            raise ValueError("No analysis available for classification")

        classification_text = _build_classification_text(analysis)
        if not classification_text:
            raise ValueError("No analysis text available for classification")

        lang = doc.get("lang", "en")
        classification = agent_service.classify_document(classification_text, lang=lang)

        # Save classification
        now = datetime.now(timezone.utc)
        classification["classifiedAt"] = now.isoformat()
        doc = cosmos.get_document(doc_id, channel_id)
        if not doc:
            return
        doc["documentClassification"] = classification
        doc["updatedInDbAt"] = now.isoformat()
        cosmos.upsert_document(doc)

    # Step 2: Get all docs in same channel
    all_docs = cosmos.query_documents(channel_id)

    # Step 3: Filter candidates
    agent_candidates, reference_matches = find_candidates(
        doc_id, classification, all_docs
    )

    # Build combined results
    all_relationships = list(reference_matches)  # Start with programmatic references

    # Step 4: Agent-based relationship analysis (only if we have candidates)
    if agent_candidates:
        source_meta = {
            "docId": doc_id,
            "stage": classification.get("stage", ""),
            "title": classification.get("title", ""),
            "summary": classification.get("summary", ""),
            "documentNumber": classification.get("documentNumber"),
            "referencedIds": classification.get("referencedIds", []),
            "subsystem": classification.get("subsystem"),
            "moduleName": classification.get("moduleName"),
            "productFamily": classification.get("productFamily"),
            "keyTerms": classification.get("keyTerms", []),
        }
        candidate_metas = []
        for c in agent_candidates:
            c_cls = c.get("documentClassification", {})
            candidate_metas.append({
                "docId": c["id"],
                "stage": c_cls.get("stage", ""),
                "title": c_cls.get("title", ""),
                "summary": c_cls.get("summary", ""),
                "documentNumber": c_cls.get("documentNumber"),
                "referencedIds": c_cls.get("referencedIds", []),
                "subsystem": c_cls.get("subsystem"),
                "moduleName": c_cls.get("moduleName"),
                "productFamily": c_cls.get("productFamily"),
                "keyTerms": c_cls.get("keyTerms", []),
            })

        agent_results = agent_service.analyze_document_relationships(
            source_meta, candidate_metas
        )
        for rel in agent_results:
            all_relationships.append({
                "targetDocId": rel.get("targetDocId", ""),
                "relationshipType": rel.get("relationshipType", ""),
                "confidence": rel.get("confidence", "low"),
                "reason": rel.get("reason", ""),
            })

    # Step 5: Save bidirectional relationships
    now = datetime.now(timezone.utc)
    for rel in all_relationships:
        rel["extractedAt"] = now.isoformat()

    doc = cosmos.get_document(doc_id, channel_id)
    if not doc:
        return
    doc["relationships"] = all_relationships
    doc["relationshipStatus"] = "completed"
    doc["relationshipError"] = None
    doc["updatedInDbAt"] = now.isoformat()
    cosmos.upsert_document(doc)

    # Save reverse relationships to target documents
    reverse_errors = []
    for rel in all_relationships:
        target_id = rel.get("targetDocId", "")
        if not target_id:
            continue
        reverse_type = REVERSE_RELATIONSHIP.get(rel["relationshipType"], rel["relationshipType"])
        reverse_rel = {
            "targetDocId": doc_id,
            "relationshipType": reverse_type,
            "confidence": rel.get("confidence", "low"),
            "reason": rel.get("reason", ""),
            "extractedAt": now.isoformat(),
        }
        try:
            _append_relationship_to_target(cosmos, target_id, channel_id, reverse_rel)
        except Exception as e:
            logger.warning("Failed to save reverse relationship to %s: %s", target_id, e)
            reverse_errors.append(f"{target_id}: {e}")

    if reverse_errors:
        doc = cosmos.get_document(doc_id, channel_id)
        if doc:
            doc["relationshipError"] = f"Partial reverse save failures: {'; '.join(reverse_errors)}"
            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
            cosmos.upsert_document(doc)

    logger.info("Relationship extraction completed for %s: %d relationships", doc_id, len(all_relationships))


def _append_relationship_to_target(cosmos, target_doc_id: str, channel_id: str, reverse_rel: dict) -> None:
    """Append a reverse relationship to a target document with retry."""
    def do_append():
        target_doc = cosmos.get_document(target_doc_id, channel_id)
        if not target_doc:
            logger.warning("Target doc %s not found for reverse relationship", target_doc_id)
            return
        existing = target_doc.get("relationships", [])
        # Avoid duplicate: same source + same type
        source_id = reverse_rel["targetDocId"]
        rel_type = reverse_rel["relationshipType"]
        existing = [r for r in existing if not (r.get("targetDocId") == source_id and r.get("relationshipType") == rel_type)]
        existing.append(reverse_rel)
        target_doc["relationships"] = existing
        target_doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
        cosmos.upsert_document(target_doc)

    retry_with_backoff(do_append, max_retries=3, base_delay=1.0)


def find_candidates(doc_id: str, classification: dict, all_docs: list) -> tuple:
    """Filter candidates from all docs. Returns (agent_candidates, reference_matches)."""
    stage = classification.get("stage", "")
    my_referenced_ids = set(classification.get("referencedIds", []))
    my_doc_number = classification.get("documentNumber")

    adjacent = ADJACENT_STAGES.get(stage, {})
    upstream_stages = set(adjacent.get("upstream", []))
    downstream_stages = set(adjacent.get("downstream", []))
    adjacent_stages = upstream_stages | downstream_stages

    agent_candidates = []
    reference_matches = []

    for d in all_docs:
        if d["id"] == doc_id:
            continue
        d_cls = d.get("documentClassification")
        if not d_cls:
            continue

        d_stage = d_cls.get("stage", "")
        d_doc_number = d_cls.get("documentNumber")
        d_referenced_ids = set(d_cls.get("referencedIds", []))

        # Check if this doc is a candidate for agent-based analysis
        # (adjacent stage for derived_from/decomposed_to, or same stage for reused_from)
        if d_stage in adjacent_stages or d_stage == stage:
            agent_candidates.append(d)

        # Programmatic references check: does source reference target's documentNumber?
        if d_doc_number and d_doc_number in my_referenced_ids:
            reference_matches.append({
                "targetDocId": d["id"],
                "relationshipType": "refers_to",
                "confidence": "high",
                "reason": f"Document number {d_doc_number} is explicitly referenced in the source document.",
            })
        # Or does target reference source's documentNumber?
        elif my_doc_number and my_doc_number in d_referenced_ids:
            reference_matches.append({
                "targetDocId": d["id"],
                "relationshipType": "referred_by",
                "confidence": "high",
                "reason": f"Target document explicitly references source document number {my_doc_number}.",
            })

    return agent_candidates, reference_matches
