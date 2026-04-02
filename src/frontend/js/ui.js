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
    return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
    });
}

export function renderChannels(channels, selectEl) {
    selectEl.innerHTML = '<option value="">Select a Teams Channel...</option>';
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
        containerEl.innerHTML = '<p class="placeholder-text">No files in this channel</p>';
        return;
    }
    files.forEach((f) => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.dataset.docId = f.docId || "";
        item.dataset.driveItemId = f.driveItemId || "";
        item.innerHTML = `
            <span class="file-icon">📄</span>
            <span class="file-name">${escapeHtml(f.name)}</span>
            <span class="file-date">${formatDate(f.lastModifiedDateTime)}</span>
        `;
        item.addEventListener("click", () => {
            containerEl.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
            item.classList.add("active");
            onSelect(f);
        });
        containerEl.appendChild(item);
    });
}

export function renderFileDetails(doc, detailsEl) {
    detailsEl.innerHTML = `
        <div class="detail-header">
            <div class="detail-doc-id">${escapeHtml(doc.id)}</div>
            <div class="detail-filename">${escapeHtml(doc.fileName || "—")}</div>
            <div class="detail-meta">
                <div class="detail-meta-item">
                    <label>Created</label>
                    <span>${formatDate(doc.createdAt)}</span>
                </div>
                <div class="detail-meta-item">
                    <label>Created By</label>
                    <span>${escapeHtml(doc.createdBy || "—")}</span>
                </div>
                <div class="detail-meta-item">
                    <label>Last Modified</label>
                    <span>${formatDate(doc.lastModifiedAt)}</span>
                </div>
                <div class="detail-meta-item">
                    <label>Last Modified By</label>
                    <span>${escapeHtml(doc.lastModifiedBy || "—")}</span>
                </div>
            </div>
        </div>
        <div class="questions-section">
            <h3>Follow-up Questions & Answers</h3>
            ${renderQuestionsList(doc.followUpQuestions || [])}
        </div>
    `;
}

function renderQuestionsList(questions) {
    if (questions.length === 0) {
        return '<p class="placeholder-text">No follow-up questions generated yet</p>';
    }
    return questions.map((q, i) => `
        <div class="question-item">
            <div class="question-text">Q${i + 1}: ${escapeHtml(q.question)}</div>
            <div class="question-answer">
                ${q.status === "answered"
                    ? `<span class="badge badge-answered">Answered</span>
                       ${renderConversationThread(q)}`
                    : '<span class="badge badge-pending">Not Available</span>'
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
                <span class="thread-msg-label">${msg.role === 'user' ? escapeHtml(q.answeredBy || 'User') : 'AI'}</span>
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
                <span class="chat-progress">Question ${index + 1} of ${total}</span>
                <span class="perspective-badge">${escapeHtml(question.perspective || "")}</span>
            </div>
            <div id="chat-messages" class="chat-messages">
                <div class="chat-bubble chat-bubble-ai">
                    <div class="chat-bubble-label">AI</div>
                    <div class="chat-bubble-text">${escapeHtml(question.question)}</div>
                </div>
            </div>
            <div class="chat-input-area">
                <textarea id="answer-input" class="chat-input" placeholder="Type your answer..." rows="2"></textarea>
                <div class="chat-actions">
                    <button id="btn-skip-question" class="btn btn-secondary">Skip</button>
                    <button id="btn-submit-answer" class="btn btn-primary">Send</button>
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
    bubble.innerHTML = `<div class="chat-bubble-label">You</div><div class="chat-bubble-text">${escapeHtml(text)}</div>`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

export function appendAiMessage(text, type) {
    const messages = document.getElementById("chat-messages");
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble-ai ${type === "insufficient" ? "chat-bubble-warn" : ""}`;
    bubble.innerHTML = `<div class="chat-bubble-label">AI</div><div class="chat-bubble-text">${escapeHtml(text)}</div>`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

export function appendAnalyzingIndicator() {
    const messages = document.getElementById("chat-messages");
    const indicator = document.createElement("div");
    indicator.id = "analyzing-indicator";
    indicator.className = "chat-bubble chat-bubble-ai";
    indicator.innerHTML = `<div class="chat-bubble-label">AI</div><div class="analyzing-indicator"><div class="spinner"></div> Analyzing your answer...</div>`;
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
            <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">All Questions Completed</p>
            <p style="color: var(--text-secondary); font-size: 14px;">${escapeHtml(message)}</p>
            <button class="btn btn-primary" style="margin-top: 20px;" onclick="document.getElementById('question-modal').classList.add('hidden')">Close</button>
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
