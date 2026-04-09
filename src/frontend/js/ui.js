import { t, getLang } from "./i18n.js";

export function showToast(message, isError = false) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

export function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(t("dateLocale"), {
        year: "numeric", month: "short", day: "numeric",
    });
}

export function renderChannels(channels, selectEl) {
    selectEl.innerHTML = `<option value="">${escapeHtml(t("channelPlaceholder"))}</option>`;
    channels.forEach((ch) => {
        const opt = document.createElement("option");
        opt.value = JSON.stringify({ teamId: ch.teamId, channelId: ch.channelId });
        opt.textContent = `${ch.teamName} > ${ch.channelName}`;
        selectEl.appendChild(opt);
    });
    selectEl.disabled = false;
}

export function renderFileList(files, containerEl, onSelect) {
    containerEl.innerHTML = "";
    if (files.length === 0) {
        containerEl.innerHTML = `<p class="placeholder-text">${escapeHtml(t("noFilesPlaceholder"))}</p>`;
        return;
    }
    files.forEach((f) => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.dataset.docId = f.docId || "";
        item.dataset.driveItemId = f.driveItemId || "";

        item.innerHTML = `
            <span class="file-icon">📄</span>
            <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span class="file-date">${formatDate(f.lastModifiedDateTime)}</span>
        `;
        // Single click: select file
        item.addEventListener("click", () => {
            containerEl.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
            item.classList.add("active");
            onSelect(f);
        });
        // Double click: open SharePoint URL in new tab
        if (f.webUrl) {
            item.addEventListener("dblclick", () => {
                window.open(f.webUrl, "_blank", "noopener");
            });
        }
        containerEl.appendChild(item);
    });
}

export function renderFileDetails(doc, detailsEl) {
    detailsEl.innerHTML = `
        <div class="tab-bar">
            <button class="tab-btn tab-active" data-tab="details">${escapeHtml(t("tabDetails"))}</button>
            <button class="tab-btn" data-tab="relationships">${escapeHtml(t("tabRelationships"))}</button>
            <button class="tab-btn" data-tab="graph">${escapeHtml(t("tabGraph"))}</button>
        </div>
        <div class="tab-content tab-details" id="tab-details">
            <div class="detail-header">
                <div class="detail-doc-id">${escapeHtml(doc.id)}</div>
                <div class="detail-filename">${escapeHtml(doc.fileName || "—")}</div>
                <div class="detail-meta">
                    <div class="detail-meta-item">
                        <label>${escapeHtml(t("labelCreated"))}</label>
                        <span>${formatDate(doc.createdAt)}</span>
                    </div>
                    <div class="detail-meta-item">
                        <label>${escapeHtml(t("labelCreatedBy"))}</label>
                        <span>${escapeHtml(doc.createdBy || "—")}</span>
                    </div>
                    <div class="detail-meta-item">
                        <label>${escapeHtml(t("labelLastModified"))}</label>
                        <span>${formatDate(doc.lastModifiedAt)}</span>
                    </div>
                    <div class="detail-meta-item">
                        <label>${escapeHtml(t("labelLastModifiedBy"))}</label>
                        <span>${escapeHtml(doc.lastModifiedBy || "—")}</span>
                    </div>
                </div>
            </div>
            <div class="analysis-section">
                <button id="btn-show-analysis" class="btn btn-analysis" ${doc.analysis ? '' : 'disabled'}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    ${escapeHtml(t("btnShowAnalysis"))}
                </button>
            </div>
            <div class="questions-section">
                <h3>${escapeHtml(t("followUpQuestionsAndAnswers"))}</h3>
                ${renderQuestionsList(doc.followUpQuestions || [])}
            </div>
            <div class="delete-section">
                <button id="btn-delete-document" class="btn btn-danger" data-doc-id="${escapeHtml(doc.id)}" data-channel-id="${escapeHtml(doc.channelId || "")}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    ${escapeHtml(t("btnDeleteDocument"))}
                </button>
            </div>
        </div>
        <div class="tab-content tab-relationships hidden" id="tab-relationships">
            <div id="relationships-content"></div>
        </div>
        <div class="tab-content tab-graph hidden" id="tab-graph">
            <div id="graph-content"></div>
        </div>
    `;

    // Tab switching
    detailsEl.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            detailsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
            btn.classList.add('tab-active');
            detailsEl.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            const target = detailsEl.querySelector(`#tab-${btn.dataset.tab}`);
            if (target) target.classList.remove('hidden');

            // Lazy-load enriched relationship data on first tab open
            if (btn.dataset.tab === 'relationships') {
                const container = document.getElementById('relationships-content');
                if (container && container.dataset.needsEnrich === 'true' && container.dataset.docId) {
                    container.dataset.needsEnrich = 'false';
                    if (typeof window._loadEnrichedRelationships === 'function') {
                        window._loadEnrichedRelationships(container.dataset.docId, container.dataset.channelId);
                    }
                }
            }
            // Lazy-load graph on first tab open
            if (btn.dataset.tab === 'graph') {
                const gc = document.getElementById('graph-content');
                if (gc && gc.dataset.needsLoad === 'true' && gc.dataset.docId) {
                    gc.dataset.needsLoad = 'false';
                    if (typeof window._loadGraphData === 'function') {
                        window._loadGraphData(gc.dataset.docId, gc.dataset.channelId);
                    }
                }
            }
        });
    });

    const btnAnalysis = document.getElementById('btn-show-analysis');
    if (btnAnalysis && doc.analysis) {
        btnAnalysis.addEventListener('click', () => showAnalysisModal(doc.analysis));
    }

    // Render initial relationships content from doc data
    // Note: doc from GET /api/documents/{doc_id} has raw relationships without targetTitle/targetStage.
    // The Relationships tab will fetch enriched data via the dedicated relationships API when the tab is clicked.
    _renderRelationshipsInitial(doc);
}

function _renderRelationshipsInitial(doc) {
    const container = document.getElementById('relationships-content');
    if (!container) return;

    const status = doc.relationshipStatus;

    // If still processing, show spinner
    if (status === "queued" || status === "extracting") {
        renderRelationshipsContent(doc);
        return;
    }

    // If error, show error
    if (status === "error") {
        renderRelationshipsContent(doc);
        return;
    }

    // If completed or null, show a "click to load" or auto-load placeholder
    // We set a flag to lazy-load enriched data when tab is first opened
    container.dataset.needsEnrich = "true";
    container.dataset.docId = doc.id;
    container.dataset.channelId = doc.channelId || "";

    // Show a lightweight preview from raw doc data
    renderRelationshipsContent(doc);

    // Set up graph tab lazy-load
    const gc = document.getElementById('graph-content');
    if (gc) {
        gc.dataset.needsLoad = "true";
        gc.dataset.docId = doc.id;
        gc.dataset.channelId = doc.channelId || "";
    }
}

const STAGE_LABELS = {
    customer_requirements: "relStageCustomerRequirements",
    requirements_definition: "relStageRequirementsDefinition",
    basic_design: "relStageBasicDesign",
    detailed_design: "relStageDetailedDesign",
    module_design: "relStageModuleDesign",
    implementation: "relStageImplementation",
};

const RELATIONSHIP_LABELS = {
    depends_on: "relDependsOn",
    depended_by: "relDependedBy",
    refers_to: "relRefersTo",
    referred_by: "relReferredBy",
};

function stageLabel(stage) {
    return t(STAGE_LABELS[stage] || stage || "—");
}

function relationshipLabel(type) {
    return t(RELATIONSHIP_LABELS[type] || type || "—");
}

export function renderRelationshipsContent(doc) {
    const container = document.getElementById('relationships-content');
    if (!container) return;

    const status = doc.relationshipStatus;
    const classification = doc.documentClassification;
    const relationships = doc.relationships || [];

    if (status === "queued" || status === "extracting") {
        container.innerHTML = `
            <div class="rel-loading">
                <div class="spinner"></div>
                <p>${escapeHtml(t("relExtracting"))}</p>
            </div>`;
        return;
    }

    if (status === "error") {
        container.innerHTML = `
            <div class="rel-error">
                <span class="rel-error-icon">⚠️</span>
                <span>${escapeHtml(t("relExtractionFailed"))}: ${escapeHtml(doc.relationshipError || "")}</span>
            </div>`;
        return;
    }

    let classificationHtml = '';
    if (classification) {
        classificationHtml = `
            <div class="rel-classification">
                <h4>${escapeHtml(t("relDocClassification"))}</h4>
                <div class="rel-classification-meta">
                    <span><strong>${escapeHtml(t("relStage"))}:</strong> ${escapeHtml(stageLabel(classification.stage))}</span>
                    ${classification.subsystem ? `<span><strong>${escapeHtml(t("relSubsystem"))}:</strong> ${escapeHtml(classification.subsystem)}</span>` : ''}
                    ${classification.moduleName ? `<span><strong>${escapeHtml(t("relModule"))}:</strong> ${escapeHtml(classification.moduleName)}</span>` : ''}
                </div>
            </div>`;
    }

    let relationshipsHtml = '';
    if (relationships.length === 0) {
        relationshipsHtml = `<p class="placeholder-text">${escapeHtml(t("relNoRelationships"))}</p>`;
    } else {
        // Split into upstream (depends_on, refers_to) and downstream (depended_by, referred_by)
        const UPSTREAM_TYPES = new Set(["depends_on", "refers_to"]);
        const DOWNSTREAM_TYPES = new Set(["depended_by", "referred_by"]);

        const upstreamRels = relationships.filter(r => UPSTREAM_TYPES.has(r.relationshipType));
        const downstreamRels = relationships.filter(r => DOWNSTREAM_TYPES.has(r.relationshipType));

        function groupByTarget(rels) {
            const grouped = {};
            for (const rel of rels) {
                const key = rel.targetDocId || "unknown";
                if (!grouped[key]) {
                    grouped[key] = {
                        targetDocId: rel.targetDocId || "",
                        targetFileName: rel.targetFileName || rel.targetTitle || rel.targetDocId || "—",
                        targetStage: rel.targetStage || null,
                        targetWebUrl: rel.targetWebUrl || "",
                        relations: [],
                    };
                }
                grouped[key].relations.push(rel);
            }
            return Object.values(grouped);
        }

        function renderGroup(groups) {
            return groups.map(group => {
                const fileNameHtml = group.targetWebUrl
                    ? `<a href="${escapeHtml(group.targetWebUrl)}" target="_blank" rel="noopener">${escapeHtml(group.targetFileName)}</a>`
                    : escapeHtml(group.targetFileName);

                const relationsHtml = group.relations.map(rel => `
                    <div class="rel-relation-item">
                        <span class="rel-relation-type">${escapeHtml(relationshipLabel(rel.relationshipType))}</span>
                        ${rel.confidence ? `<span class="rel-confidence rel-confidence-${escapeHtml(rel.confidence)}">${escapeHtml(rel.confidence)}</span>` : ''}
                        ${rel.reason ? `<div class="rel-relation-reason">${escapeHtml(rel.reason)}</div>` : ''}
                    </div>
                `).join('');

                return `
                    <div class="rel-card">
                        <div class="rel-card-target">📄 ${fileNameHtml} <span class="rel-card-doc-id">(${escapeHtml(group.targetDocId)})</span></div>
                        ${group.targetStage ? `<div class="rel-card-meta"><span>${escapeHtml(t("relStage"))}: ${escapeHtml(stageLabel(group.targetStage))}</span></div>` : ''}
                        <div class="rel-relations-list">${relationsHtml}</div>
                    </div>
                `;
            }).join('');
        }

        const upstreamGroups = groupByTarget(upstreamRels);
        const downstreamGroups = groupByTarget(downstreamRels);

        const upstreamHtml = upstreamGroups.length > 0
            ? renderGroup(upstreamGroups)
            : `<p class="placeholder-text">${escapeHtml(t("relNoUpstream"))}</p>`;

        const downstreamHtml = downstreamGroups.length > 0
            ? renderGroup(downstreamGroups)
            : `<p class="placeholder-text">${escapeHtml(t("relNoDownstream"))}</p>`;

        relationshipsHtml = `
            <div class="rel-section">
                <h4 class="rel-section-header rel-section-upstream">⬆ ${escapeHtml(t("relUpstream"))}</h4>
                ${upstreamHtml}
            </div>
            <div class="rel-section">
                <h4 class="rel-section-header rel-section-downstream">⬇ ${escapeHtml(t("relDownstream"))}</h4>
                ${downstreamHtml}
            </div>`;
    }

    container.innerHTML = `
        ${classificationHtml}
        <div class="rel-list">
            <h4>${escapeHtml(t("relRelatedDocuments"))}</h4>
            ${relationshipsHtml}
        </div>`;
}

export function updateRelationshipsFromApi(data) {
    const container = document.getElementById('relationships-content');
    if (!container) return;
    renderRelationshipsContent(data);
}

function renderQuestionsList(questions) {
    if (questions.length === 0) {
        return `<p class="placeholder-text">${escapeHtml(t("noQuestionsYet"))}</p>`;
    }
    return questions.map((q, i) => `
        <div class="question-item">
            <div class="question-text">Q${i + 1}: ${escapeHtml(q.question)}</div>
            <div class="question-answer">
                ${q.status === "answered"
                    ? `<span class="badge badge-answered">${escapeHtml(t("badgeAnswered"))}</span>
                       ${renderConversationThread(q)}`
                    : `<span class="badge badge-pending">${escapeHtml(t("badgePending"))}</span>`
                }
            </div>
        </div>
    `).join("");
}

function renderConversationThread(q) {
    const thread = q.conversationThread || [];
    if (thread.length === 0) {
        return '';
    }
    return `<div class="conversation-thread">
        ${thread.map(msg => `
            <div class="thread-msg thread-msg-${msg.role === 'user' ? 'user' : 'ai'}">
                <span class="thread-msg-label">${msg.role === 'user' ? escapeHtml(q.answeredBy || t("labelYou")) : t("labelAI")}</span>
                <span class="thread-msg-text">${escapeHtml(msg.text)}</span>
            </div>
        `).join('')}
    </div>`;
}

export function showModal() {
    document.getElementById("question-modal").classList.remove("hidden");
}

export function hideModal() {
    document.getElementById("question-modal").classList.add("hidden");
}

export function renderModalQuestion(question, index, total, onSubmit, onSkip) {
    const body = document.getElementById("modal-body");
    body.innerHTML = `
        <div class="chat-thread">
            <div class="chat-header">
                <span class="chat-progress">${escapeHtml(t("questionProgress", { current: index + 1, total: total }))}</span>
                <span class="perspective-badge">${escapeHtml(question.perspective || "")}</span>
            </div>
            <div id="chat-messages" class="chat-messages">
                <div class="chat-bubble chat-bubble-ai">
                    <div class="chat-bubble-label">${escapeHtml(t("labelAI"))}</div>
                    <div class="chat-bubble-text">${escapeHtml(question.question)}</div>
                </div>
            </div>
            <div class="chat-input-area">
                <textarea id="answer-input" class="chat-input" placeholder="${escapeHtml(t("answerPlaceholder"))}" rows="2"></textarea>
                <div class="chat-actions">
                    <button id="btn-skip-question" class="btn btn-secondary">${escapeHtml(t("btnSkip"))}</button>
                    <button id="btn-submit-answer" class="btn btn-primary">${escapeHtml(t("btnSend"))}</button>
                </div>
            </div>
        </div>
    `;
    const input = document.getElementById("answer-input");
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const answer = input.value.trim();
            if (answer) onSubmit(answer);
        }
    });
    document.getElementById("btn-submit-answer").addEventListener("click", () => {
        const answer = input.value.trim();
        if (answer) onSubmit(answer);
    });
    document.getElementById("btn-skip-question").addEventListener("click", () => {
        onSkip();
    });
}

export function appendUserMessage(text) {
    const messages = document.getElementById("chat-messages");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-bubble-user";
    bubble.innerHTML = `<div class="chat-bubble-label">${escapeHtml(t("labelYou"))}</div><div class="chat-bubble-text">${escapeHtml(text)}</div>`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

export function appendAiMessage(text, type) {
    const messages = document.getElementById("chat-messages");
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble-ai ${type === "insufficient" ? "chat-bubble-warn" : ""}`;
    bubble.innerHTML = `<div class="chat-bubble-label">${escapeHtml(t("labelAI"))}</div><div class="chat-bubble-text">${escapeHtml(text)}</div>`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

export function appendAnalyzingIndicator() {
    const messages = document.getElementById("chat-messages");
    const indicator = document.createElement("div");
    indicator.id = "analyzing-indicator";
    indicator.className = "chat-bubble chat-bubble-ai";
    indicator.innerHTML = `<div class="chat-bubble-label">${escapeHtml(t("labelAI"))}</div><div class="analyzing-indicator"><div class="spinner"></div> ${escapeHtml(t("analyzingAnswer"))}</div>`;
    messages.appendChild(indicator);
    messages.scrollTop = messages.scrollHeight;
}

export function removeAnalyzingIndicator() {
    const el = document.getElementById("analyzing-indicator");
    if (el) el.remove();
}

export function setChatInputEnabled(enabled) {
    const input = document.getElementById("answer-input");
    const btn = document.getElementById("btn-submit-answer");
    const skip = document.getElementById("btn-skip-question");
    if (input) input.disabled = !enabled;
    if (btn) btn.disabled = !enabled;
    if (skip) skip.disabled = !enabled;
}

export function renderModalComplete(message) {
    const body = document.getElementById("modal-body");
    body.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#107c10" stroke-width="2" style="margin-bottom: 16px;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">${escapeHtml(t("allQuestionsCompleted"))}</p>
            <p style="color: var(--text-secondary); font-size: 14px;">${escapeHtml(message)}</p>
            <button class="btn btn-primary" style="margin-top: 20px;" onclick="document.getElementById('question-modal').classList.add('hidden')">${escapeHtml(t("btnClose"))}</button>
        </div>
    `;
}

export function renderUploadProgress(message) {
    const body = document.getElementById("modal-body");
    body.innerHTML = `
        <div class="upload-progress">
            <div class="spinner"></div>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
    showModal();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function showAnalysisModal(analysis) {
    const modal = document.getElementById('analysis-modal');
    const body = document.getElementById('analysis-modal-body');

    const analyzedAt = analysis.analyzedAt ? formatDate(analysis.analyzedAt) : '—';
    const modelVersion = escapeHtml(analysis.modelVersion || '—');

    let tablesHtml = '';
    if (analysis.tables && analysis.tables.length > 0) {
        tablesHtml = `<div class="analysis-block">
            <h4>${escapeHtml(t('analysisTables'))} (${analysis.tables.length})</h4>
            <ul class="analysis-list">${analysis.tables.map((tb, i) =>
                `<li>${escapeHtml(t('analysisTable'))} ${i + 1}: ${tb.rowCount} rows × ${tb.columnCount} cols</li>`
            ).join('')}</ul>
        </div>`;
    }

    let kvpHtml = '';
    if (analysis.keyValuePairs && analysis.keyValuePairs.length > 0) {
        kvpHtml = `<div class="analysis-block">
            <h4>${escapeHtml(t('analysisKeyValuePairs'))} (${analysis.keyValuePairs.length})</h4>
            <ul class="analysis-list">${analysis.keyValuePairs.map(kv =>
                `<li><strong>${escapeHtml(kv.key)}</strong>: ${escapeHtml(kv.value)}</li>`
            ).join('')}</ul>
        </div>`;
    }

    const extractedText = analysis.extractedText || '';

    // Render markdown to HTML and sanitize
    let renderedText;
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        renderedText = DOMPurify.sanitize(marked.parse(extractedText));
    } else {
        renderedText = `<pre>${escapeHtml(extractedText)}</pre>`;
    }

    body.innerHTML = `
        <div class="analysis-meta">
            <span><strong>${escapeHtml(t('analysisModel'))}:</strong> ${modelVersion}</span>
            <span><strong>${escapeHtml(t('analysisAnalyzedAt'))}:</strong> ${analyzedAt}</span>
        </div>
        ${tablesHtml}
        ${kvpHtml}
        <div class="analysis-block">
            <h4>${escapeHtml(t('analysisExtractedText'))}</h4>
            <div class="analysis-extracted-text analysis-markdown">${renderedText}</div>
        </div>
    `;

    modal.classList.remove('hidden');
}

export function hideAnalysisModal() {
    document.getElementById('analysis-modal').classList.add('hidden');
}

// ===================== Graph Tab =====================

const STAGE_ORDER = [
    "customer_requirements",
    "requirements_definition",
    "basic_design",
    "detailed_design",
    "module_design",
    "implementation",
];

export function renderGraph(data, currentDocId) {
    const container = document.getElementById('graph-content');
    if (!container) return;

    const nodes = data.nodes || [];
    const edges = data.edges || [];

    if (nodes.length === 0) {
        container.innerHTML = `<p class="placeholder-text">${escapeHtml(t("graphNoData"))}</p>`;
        return;
    }

    // Build node map
    const nodesMap = {};
    for (const n of nodes) {
        nodesMap[n.docId] = {
            id: n.docId,
            label: n.fileName || n.docId,
            stage: n.stage || "",
            webUrl: n.webUrl || "",
            isCurrent: n.docId === currentDocId,
        };
    }

    // Build edge list with type classification
    const graphEdges = edges.map(e => ({
        from: e.from,
        to: e.to,
        type: e.relationshipType === "depends_on" ? "dependency" : "reference",
        confidence: e.confidence || "low",
        reason: e.reason || "",
    }));

    // Render filter bar + SVG
    container.innerHTML = `
        <div class="graph-filters">
            <label class="graph-filter-label">${escapeHtml(t("relConfidence"))}:</label>
            <label class="graph-filter-cb"><input type="checkbox" data-filter="high" checked> ${escapeHtml(t("graphFilterHigh"))}</label>
            <label class="graph-filter-cb"><input type="checkbox" data-filter="medium" checked> ${escapeHtml(t("graphFilterMedium"))}</label>
            <label class="graph-filter-cb"><input type="checkbox" data-filter="low" checked> ${escapeHtml(t("graphFilterLow"))}</label>
            <span class="graph-filter-sep">|</span>
            <label class="graph-filter-cb"><input type="checkbox" data-filter="dependency" checked> ${escapeHtml(t("graphFilterDependency"))}</label>
            <label class="graph-filter-cb"><input type="checkbox" data-filter="reference" checked> ${escapeHtml(t("graphFilterReference"))}</label>
        </div>
        <div class="graph-viewport" id="graph-viewport">
            <svg id="graph-svg"></svg>
        </div>
    `;

    // Layout: group nodes by stage, left (upstream) → right (downstream)
    const NODE_W = 200, NODE_H = 48, PAD_X = 300, PAD_Y = 100;
    const stageColumns = {};
    for (const n of Object.values(nodesMap)) {
        const col = STAGE_ORDER.indexOf(n.stage);
        const colIdx = col >= 0 ? col : STAGE_ORDER.length;
        if (!stageColumns[colIdx]) stageColumns[colIdx] = [];
        stageColumns[colIdx].push(n);
    }

    // Assign x, y positions
    const usedColumns = Object.keys(stageColumns).map(Number).sort((a, b) => a - b);
    usedColumns.forEach((colIdx, ci) => {
        const colNodes = stageColumns[colIdx];
        const x = 140 + ci * (NODE_W + PAD_X);
        colNodes.forEach((n, ri) => {
            n.x = x;
            n.y = 80 + ri * (NODE_H + PAD_Y);
        });
    });

    // Calculate SVG dimensions
    const allNodes = Object.values(nodesMap);
    const svgW = Math.max(1200, (allNodes.length > 0 ? Math.max(...allNodes.map(n => n.x)) + NODE_W + 140 : 1200));
    const svgH = Math.max(600, (allNodes.length > 0 ? Math.max(...allNodes.map(n => n.y)) + NODE_H + 140 : 600));

    const viewport = document.getElementById('graph-viewport');
    const svgEl = document.getElementById('graph-svg');
    svgEl.setAttribute('width', svgW);
    svgEl.setAttribute('height', svgH);

    // Edges connected to the current node (for highlighting)
    const currentEdgeKeys = new Set();
    graphEdges.forEach(e => {
        if (e.from === currentDocId || e.to === currentDocId) {
            currentEdgeKeys.add(`${e.from}-${e.to}`);
        }
    });

    // Center scroll on current node
    const curNode = allNodes.find(n => n.isCurrent);
    if (curNode && viewport) {
        setTimeout(() => {
            viewport.scrollLeft = Math.max(0, curNode.x - viewport.clientWidth / 2 + NODE_W / 2);
            viewport.scrollTop = Math.max(0, curNode.y - viewport.clientHeight / 2 + NODE_H / 2);
        }, 0);
    }

    // Mouse drag panning
    let isDragging = false, dragStartX = 0, dragStartY = 0, scrollStartX = 0, scrollStartY = 0;

    function onDragStart(e) {
        if (e.target.closest('.graph-node')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        scrollStartX = viewport.scrollLeft;
        scrollStartY = viewport.scrollTop;
        viewport.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }
    function onDragMove(e) {
        if (!isDragging) return;
        viewport.scrollLeft = scrollStartX - (e.clientX - dragStartX);
        viewport.scrollTop = scrollStartY - (e.clientY - dragStartY);
    }
    function onDragEnd() {
        if (isDragging) {
            isDragging = false;
            viewport.style.cursor = 'grab';
            document.body.style.userSelect = '';
        }
    }

    // Remove previous listeners if re-rendered (store refs on viewport)
    if (viewport._graphDragStart) {
        viewport.removeEventListener('mousedown', viewport._graphDragStart);
        document.removeEventListener('mousemove', viewport._graphDragMove);
        document.removeEventListener('mouseup', viewport._graphDragEnd);
    }
    viewport._graphDragStart = onDragStart;
    viewport._graphDragMove = onDragMove;
    viewport._graphDragEnd = onDragEnd;

    viewport.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    function getActiveFilters() {
        const cbs = container.querySelectorAll('.graph-filter-cb input');
        const active = new Set();
        cbs.forEach(cb => { if (cb.checked) active.add(cb.dataset.filter); });
        return active;
    }

    function drawGraph() {
        const filters = getActiveFilters();
        const filteredEdges = graphEdges.filter(e =>
            filters.has(e.type) && filters.has(e.confidence)
        );

        // Visible nodes: all nodes that have at least one edge, plus current node
        const connectedIds = new Set([currentDocId]);
        filteredEdges.forEach(e => { connectedIds.add(e.from); connectedIds.add(e.to); });
        // Show all nodes that have a classification (even if no edges)
        allNodes.forEach(n => { if (n.stage) connectedIds.add(n.id); });

        let svg = '';
        svg += `<defs>
            <marker id="arrow-dep" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#0078d4"/></marker>
            <marker id="arrow-ref" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#986f0b"/></marker>
        </defs>`;

        // Stage column headers
        usedColumns.forEach((colIdx, ci) => {
            const x = 140 + ci * (NODE_W + PAD_X);
            const stageName = colIdx < STAGE_ORDER.length ? stageLabel(STAGE_ORDER[colIdx]) : "Other";
            svg += `<text x="${x + NODE_W / 2}" y="20" text-anchor="middle" fill="#605e5c" font-size="11" font-weight="600">${escapeHtml(stageName)}</text>`;
            svg += `<line x1="${x + NODE_W / 2}" y1="28" x2="${x + NODE_W / 2}" y2="${svgH - 10}" stroke="#e1dfdd" stroke-width="1" stroke-dasharray="4,4"/>`;
        });

        // Draw edges (non-highlighted first, then highlighted on top)
        const highlightedEdges = [];
        const normalEdges = [];
        for (const e of filteredEdges) {
            const key = `${e.from}-${e.to}`;
            if (currentEdgeKeys.has(key)) {
                highlightedEdges.push(e);
            } else {
                normalEdges.push(e);
            }
        }

        function drawEdge(e, isHighlighted) {
            const fromN = nodesMap[e.from];
            const toN = nodesMap[e.to];
            if (!fromN || !toN) return '';
            if (!connectedIds.has(e.from) || !connectedIds.has(e.to)) return '';
            const baseColor = e.type === "dependency" ? "#0078d4" : "#986f0b";
            const color = isHighlighted ? baseColor : "#b0b0b0";
            const dash = e.type === "reference" ? 'stroke-dasharray="8,4"' : '';
            const marker = e.type === "dependency" ? "url(#arrow-dep)" : "url(#arrow-ref)";
            const opacity = isHighlighted ? 1 : (e.confidence === "high" ? 0.5 : (e.confidence === "medium" ? 0.35 : 0.2));
            const width = isHighlighted ? 3 : 1.5;

            const sameColumn = (fromN.x === toN.x);
            let path;
            if (sameColumn) {
                // Same-column: arc to the right side
                const x1 = fromN.x + NODE_W;
                const y1 = fromN.y + NODE_H / 2;
                const x2 = toN.x + NODE_W;
                const y2 = toN.y + NODE_H / 2;
                const bulge = 80;
                path = `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`;
            } else {
                // Different columns: smooth curve from right edge to left edge
                const x1 = fromN.x + NODE_W;
                const y1 = fromN.y + NODE_H / 2;
                const x2 = toN.x;
                const y2 = toN.y + NODE_H / 2;
                const midX = (x1 + x2) / 2;
                path = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
            }
            return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" ${dash} stroke-opacity="${opacity}" marker-end="${marker}"/>`;
        }

        // Normal edges first (background)
        for (const e of normalEdges) { svg += drawEdge(e, false); }
        // Highlighted edges on top
        for (const e of highlightedEdges) { svg += drawEdge(e, true); }

        // Draw nodes
        for (const n of allNodes) {
            if (!connectedIds.has(n.id)) continue;
            const fill = n.isCurrent ? "#0078d4" : "#ffffff";
            const textColor = n.isCurrent ? "#ffffff" : "#323130";
            const stroke = n.isCurrent ? "#005a9e" : "#a19f9d";
            const truncLabel = n.label.length > 24 ? n.label.substring(0, 22) + "…" : n.label;
            svg += `<g class="graph-node" data-id="${escapeHtml(n.id)}" data-url="${escapeHtml(n.webUrl)}">`;
            svg += `<rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
            svg += `<text x="${n.x + NODE_W / 2}" y="${n.y + 18}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="600">${escapeHtml(truncLabel)}</text>`;
            svg += `<text x="${n.x + NODE_W / 2}" y="${n.y + 34}" text-anchor="middle" fill="${n.isCurrent ? '#cce4f7' : '#605e5c'}" font-size="10">${escapeHtml(stageLabel(n.stage))}</text>`;
            svg += `</g>`;
        }

        svgEl.innerHTML = svg;

        // Double-click on node → open URL
        svgEl.querySelectorAll('.graph-node').forEach(g => {
            g.style.cursor = 'pointer';
            g.addEventListener('dblclick', () => {
                const url = g.dataset.url;
                if (url) window.open(url, '_blank', 'noopener');
            });
        });
    }

    drawGraph();

    // Filter change handlers
    container.querySelectorAll('.graph-filter-cb input').forEach(cb => {
        cb.addEventListener('change', drawGraph);
    });
}

export function initPaneDivider() {
    const divider = document.getElementById('pane-divider');
    const paneLeft = document.querySelector('.pane-left');
    if (!divider || !paneLeft) return;

    let isDragging = false;

    divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const containerRect = paneLeft.parentElement.getBoundingClientRect();
        let newWidth = e.clientX - containerRect.left;
        newWidth = Math.max(200, Math.min(newWidth, containerRect.width * 0.6));
        paneLeft.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            divider.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

export { escapeHtml as escapeHtmlPublic };

export function showConfirmDialog(title, message, okLabel, cancelLabel) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h3 class="confirm-title">${escapeHtml(title)}</h3>
                <p class="confirm-message">${escapeHtml(message)}</p>
                <div class="confirm-actions">
                    <button class="btn btn-secondary" id="confirm-cancel">${escapeHtml(cancelLabel)}</button>
                    <button class="btn btn-danger" id="confirm-ok">${escapeHtml(okLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector("#confirm-ok").addEventListener("click", () => {
            overlay.remove();
            resolve(true);
        });
        overlay.querySelector("#confirm-cancel").addEventListener("click", () => {
            overlay.remove();
            resolve(false);
        });
    });
}
