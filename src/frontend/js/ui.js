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
        </div>
        <div class="tab-content tab-relationships hidden" id="tab-relationships">
            <div id="relationships-content"></div>
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
    derived_from: "relDerivedFrom",
    decomposed_to: "relDecomposedTo",
    reused_from: "relReusedFrom",
    references: "relReferences",
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
        // Group relationships by target document
        const grouped = {};
        for (const rel of relationships) {
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

        relationshipsHtml = Object.values(grouped).map(group => {
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
