import { initAuth, login, getAccount } from "./auth.js";
import * as api from "./api.js";
import * as ui from "./ui.js";
import { t, getLang, setLang } from "./i18n.js";

let selectedTeamId = null;
let selectedChannelId = null;
let currentUserMail = "";

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const account = await initAuth();
        if (account) {
            onLoggedIn(account);
        }
    } catch (err) {
        console.error("MSAL init error:", err);
        ui.showToast(t("authInitFailed"), true);
    }

    document.getElementById("btn-login").addEventListener("click", handleLogin);
    document.getElementById("channel-select").addEventListener("change", handleChannelChange);
    document.getElementById("btn-close-modal").addEventListener("click", ui.hideModal);
    document.getElementById("btn-close-analysis-modal").addEventListener("click", ui.hideAnalysisModal);
    document.getElementById("btn-lang-toggle").addEventListener("click", handleLangToggle);

    applyStaticTranslations();
    setupDropZone();
    ui.initPaneDivider();
});

async function handleLogin() {
    try {
        const account = await login();
        onLoggedIn(account);
    } catch (err) {
        ui.showToast(t("loginFailed"), true);
    }
}

async function onLoggedIn(account) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("main-app").classList.remove("hidden");
    document.getElementById("user-name").textContent = account.name || account.username || "";

    try {
        const me = await api.getMe();
        currentUserMail = me.mail || "";
    } catch {
        // Fallback
    }

    loadChannels();
}

async function loadChannels() {
    try {
        const channels = await api.getChannels();
        ui.renderChannels(channels, document.getElementById("channel-select"));
    } catch (err) {
        ui.showToast(t("loadChannelsFailed"), true);
    }
}

async function handleChannelChange(e) {
    const val = e.target.value;
    if (!val) return;

    const { teamId, channelId } = JSON.parse(val);
    selectedTeamId = teamId;
    selectedChannelId = channelId;

    document.getElementById("drop-zone").classList.remove("hidden");
    document.getElementById("file-details").innerHTML =
        `<p class="placeholder-text">${ui.escapeHtmlPublic(t("selectFilePlaceholder"))}</p>`;

    await loadFiles();
}

async function loadFiles() {
    if (!selectedTeamId || !selectedChannelId) return;

    try {
        const files = await api.getChannelFiles(selectedTeamId, selectedChannelId);
        ui.renderFileList(files, document.getElementById("file-list"), handleFileSelect);
    } catch (err) {
        ui.showToast(t("loadFilesFailed", { message: err.message }), true);
        console.error("loadFiles error:", err);
    }
}

async function handleFileSelect(file) {
    if (!file.docId) {
        document.getElementById("file-details").innerHTML = `
            <div class="detail-header">
                <div class="detail-filename">${file.name}</div>
                <p class="placeholder-text" style="margin-top:12px">${ui.escapeHtmlPublic(t("noAnalysisData"))}</p>
            </div>`;
        return;
    }

    try {
        const doc = await api.getDocument(file.docId, selectedChannelId);
        ui.renderFileDetails(doc, document.getElementById("file-details"));

        // Register callback for lazy-loading enriched relationship data
        window._loadEnrichedRelationships = async (docId, channelId) => {
            try {
                const data = await api.getDocumentRelationships(docId, channelId || selectedChannelId);
                ui.updateRelationshipsFromApi(data);
            } catch (err) {
                console.error("Failed to load enriched relationships:", err);
            }
        };

        // Register callback for lazy-loading graph data
        window._loadGraphData = async (docId, channelId) => {
            try {
                const graphData = await api.getChannelGraph(channelId || selectedChannelId);
                ui.renderGraph(graphData, docId);
            } catch (err) {
                console.error("Failed to load graph data:", err);
            }
        };

        // If relationship extraction is in progress, start polling
        if (doc.relationshipStatus === "queued" || doc.relationshipStatus === "extracting") {
            pollRelationships(file.docId);
        }
    } catch (err) {
        ui.showToast(t("loadDetailsFailed"), true);
    }
}

function selectFileByDocId(docId) {
    const fileList = document.getElementById("file-list");
    if (!fileList) return;
    const items = fileList.querySelectorAll(".file-item");
    for (const item of items) {
        if (item.dataset.docId === docId) {
            item.click();
            item.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return;
        }
    }
}

function setupDropZone() {
    const dropZone = document.getElementById("drop-zone");

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");

        if (!selectedTeamId || !selectedChannelId) {
            ui.showToast(t("selectChannelFirst"), true);
            return;
        }

        const files = Array.from(e.dataTransfer.files);
        const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

        if (pdfFiles.length === 0) {
            ui.showToast(t("onlyPdfSupported"), true);
            return;
        }

        for (const file of pdfFiles) {
            await handleUpload(file);
        }
    });
}

async function handleUpload(file) {
    ui.renderUploadProgress(t("uploadingMessage"));

    const deepAnalysis = document.getElementById("deep-analysis-toggle")?.checked || false;

    try {
        const result = await api.uploadFile(selectedTeamId, selectedChannelId, file, deepAnalysis);

        if (result.error && !result.processingStatus) {
            ui.showToast(result.message || result.error, true);
            ui.hideModal();
            await loadFiles();
            return;
        }

        await loadFiles();

        // If backend returned processingStatus, poll until complete
        if (result.processingStatus && result.processingStatus !== "completed") {
            ui.renderUploadProgress(t("analyzingDocument"));
            const doc = await pollProcessingStatus(result.docId);

            if (!doc) {
                ui.hideModal();
                ui.showToast(t("uploadSuccess"));
                return;
            }

            if (doc.processingError) {
                ui.showToast(doc.processingError, true);
            }

            await loadFiles();

            if (doc.followUpQuestions && doc.followUpQuestions.length > 0) {
                startQuestionFlow(doc.id, doc.followUpQuestions);
            } else {
                ui.hideModal();
                ui.showToast(t("uploadSuccess"));
            }
        } else if (result.followUpQuestions && result.followUpQuestions.length > 0) {
            startQuestionFlow(result.docId, result.followUpQuestions);
        } else {
            ui.hideModal();
            ui.showToast(t("uploadSuccess"));
        }
    } catch (err) {
        ui.hideModal();
        ui.showToast(t("uploadFailed", { message: err.message }), true);
    }
}

async function pollProcessingStatus(docId) {
    const POLL_INTERVAL = 5000;
    const MAX_POLLS = 120; // 10 minutes max
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        try {
            const doc = await api.getDocument(docId, selectedChannelId);
            if (doc.processingStatus === "generating_questions") {
                ui.renderUploadProgress(t("generatingQuestions"));
            }
            if (doc.processingStatus === "completed" || doc.processingStatus === "error") {
                return doc;
            }
        } catch {
            // Continue polling on transient errors
        }
    }
    return null;
}

async function pollRelationships(docId) {
    const POLL_INTERVAL = 5000;
    const MAX_POLLS = 60; // 5 minutes max
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        try {
            const data = await api.getDocumentRelationships(docId, selectedChannelId);
            ui.updateRelationshipsFromApi(data);
            if (data.relationshipStatus === "completed" || data.relationshipStatus === "error") {
                return;
            }
        } catch {
            // Continue polling on transient errors
        }
    }
}

function startQuestionFlow(docId, questions) {
    let currentIndex = 0;

    function showNext() {
        if (currentIndex >= questions.length) {
            ui.renderModalComplete(
                t("thankYouComplete")
            );
            loadFiles().then(() => selectFileByDocId(docId));
            return;
        }

        let roundCount = 0;
        const MAX_ROUNDS = 3;

        ui.renderModalQuestion(
            questions[currentIndex],
            currentIndex,
            questions.length,
            async (answer) => {
                const q = questions[currentIndex];
                roundCount++;
                ui.appendUserMessage(answer);
                ui.setChatInputEnabled(false);
                ui.appendAnalyzingIndicator();

                try {
                    const result = await api.submitAnswer(
                        docId, q.questionId, selectedChannelId, answer, currentUserMail
                    );
                    ui.removeAnalyzingIndicator();

                    // Auto-accept after max rounds regardless of AI judgment
                    if (result.validation === "insufficient" && roundCount < MAX_ROUNDS) {
                        ui.appendAiMessage(result.feedback, "insufficient");
                        ui.setChatInputEnabled(true);
                        document.getElementById("answer-input").value = "";
                        document.getElementById("answer-input").focus();
                    } else {
                        const msg = roundCount >= MAX_ROUNDS && result.validation === "insufficient"
                            ? t("thankYouDetailed")
                            : (result.feedback || t("answerAccepted"));
                        ui.appendAiMessage(msg, "sufficient");
                        setTimeout(() => {
                            currentIndex++;
                            showNext();
                        }, 1500);
                    }
                } catch (err) {
                    ui.removeAnalyzingIndicator();
                    ui.appendAiMessage(t("answerAnalysisUnavailable"), "insufficient");
                    setTimeout(() => {
                        currentIndex++;
                        showNext();
                    }, 1500);
                }
            },
            () => {
                // Skip handler
                currentIndex++;
                showNext();
            }
        );
    }

    showNext();
}

function handleLangToggle() {
    const newLang = getLang() === "en" ? "ja" : "en";
    setLang(newLang);
    applyStaticTranslations();
}

function applyStaticTranslations() {
    const lang = getLang();
    // Toggle button: highlight active language
    const enLabel = document.getElementById("lang-en");
    const jaLabel = document.getElementById("lang-ja");
    if (enLabel) enLabel.classList.toggle("lang-active", lang === "en");
    if (jaLabel) jaLabel.classList.toggle("lang-active", lang === "ja");

    // Login screen (keep title in English)
    const loginP = document.querySelector(".login-card p");
    if (loginP) loginP.textContent = t("loginSubtitle");
    const loginBtn = document.getElementById("btn-login");
    if (loginBtn) loginBtn.textContent = t("loginButton");

    // Channel select placeholder
    const channelSelect = document.getElementById("channel-select");
    if (channelSelect && channelSelect.options.length > 0) {
        channelSelect.options[0].textContent = t("channelPlaceholder");
    }

    // Files header
    const filesH2 = document.querySelector(".pane-left h2");
    if (filesH2) filesH2.textContent = t("filesHeader");

    // Placeholder texts (only if showing default placeholder)
    const fileListPlaceholder = document.querySelector("#file-list .placeholder-text");
    if (fileListPlaceholder) {
        fileListPlaceholder.textContent = t("selectChannelPlaceholder");
    }

    const detailsPlaceholder = document.querySelector("#file-details .placeholder-text");
    if (detailsPlaceholder) {
        detailsPlaceholder.textContent = t("selectFilePlaceholder");
    }

    // Drop zone text
    const dropZoneP = document.querySelector(".drop-zone-content p");
    if (dropZoneP) dropZoneP.textContent = t("dropZoneText");

    // Modal header
    const modalH2 = document.querySelector(".modal-header h2");
    if (modalH2) modalH2.textContent = t("followUpQuestionsHeader");

    // Deep analysis toggle label
    const deepLabel = document.getElementById("deep-analysis-label");
    if (deepLabel) deepLabel.textContent = t("deepAnalysisLabel");
}
