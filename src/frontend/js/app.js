import { initAuth, login, getAccount } from "./auth.js";
import * as api from "./api.js";
import * as ui from "./ui.js";

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
        ui.showToast("Authentication initialization failed. Check console for details.", true);
    }

    document.getElementById("btn-login").addEventListener("click", handleLogin);
    document.getElementById("channel-select").addEventListener("change", handleChannelChange);
    document.getElementById("btn-close-modal").addEventListener("click", ui.hideModal);

    setupDropZone();
});

async function handleLogin() {
    try {
        const account = await login();
        onLoggedIn(account);
    } catch (err) {
        ui.showToast("Login failed. Please try again.", true);
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
        ui.showToast("Failed to load channels. Please try again.", true);
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
        '<p class="placeholder-text">Select a file to view details</p>';

    await loadFiles();
}

async function loadFiles() {
    if (!selectedTeamId || !selectedChannelId) return;

    try {
        const files = await api.getChannelFiles(selectedTeamId, selectedChannelId);
        ui.renderFileList(files, document.getElementById("file-list"), handleFileSelect);
    } catch (err) {
        ui.showToast(`Failed to load files: ${err.message}`, true);
        console.error("loadFiles error:", err);
    }
}

async function handleFileSelect(file) {
    if (!file.docId) {
        document.getElementById("file-details").innerHTML = `
            <div class="detail-header">
                <div class="detail-filename">${file.name}</div>
                <p class="placeholder-text" style="margin-top:12px">No analysis data available for this file</p>
            </div>`;
        return;
    }

    try {
        const doc = await api.getDocument(file.docId, selectedChannelId);
        ui.renderFileDetails(doc, document.getElementById("file-details"));
    } catch (err) {
        ui.showToast("Failed to load file details.", true);
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
            ui.showToast("Please select a Teams channel first.", true);
            return;
        }

        const files = Array.from(e.dataTransfer.files);
        const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

        if (pdfFiles.length === 0) {
            ui.showToast("Only PDF files are supported.", true);
            return;
        }

        for (const file of pdfFiles) {
            await handleUpload(file);
        }
    });
}

async function handleUpload(file) {
    ui.renderUploadProgress("Uploading and analyzing file...");

    try {
        const result = await api.uploadFile(selectedTeamId, selectedChannelId, file);

        if (result.error) {
            ui.showToast(result.message || result.error, true);
            ui.hideModal();
            await loadFiles();
            return;
        }

        await loadFiles();

        if (result.followUpQuestions && result.followUpQuestions.length > 0) {
            startQuestionFlow(result.docId, result.followUpQuestions);
        } else {
            ui.hideModal();
            ui.showToast("File uploaded successfully.");
        }
    } catch (err) {
        ui.hideModal();
        ui.showToast(`Upload failed: ${err.message}`, true);
    }
}

function startQuestionFlow(docId, questions) {
    let currentIndex = 0;

    function showNext() {
        if (currentIndex >= questions.length) {
            ui.renderModalComplete(
                "Thank you for providing these valuable insights. Your expertise will help ensure the quality and completeness of this document."
            );
            loadFiles();
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
                            ? "Thank you for your detailed responses. Your input has been recorded."
                            : (result.feedback || "Answer accepted. Moving to next question.");
                        ui.appendAiMessage(msg, "sufficient");
                        setTimeout(() => {
                            currentIndex++;
                            showNext();
                        }, 1500);
                    }
                } catch (err) {
                    ui.removeAnalyzingIndicator();
                    ui.appendAiMessage("Answer analysis temporarily unavailable. Your answer has been saved.", "insufficient");
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
