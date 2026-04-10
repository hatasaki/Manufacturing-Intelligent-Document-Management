import { getAccessToken } from "./auth.js";
import { API_BASE } from "./config.js";
import { getLang } from "./i18n.js";

async function apiRequest(url, options = {}) {
    const token = await getAccessToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        ...options.headers,
    };

    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });

    if (!response.ok && response.status !== 207) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${response.status}`);
    }

    return response.json();
}

export async function getMe() {
    return apiRequest("/me");
}

export async function getChannels() {
    return apiRequest("/teams/channels");
}

export async function getChannelFiles(teamId, channelId) {
    return apiRequest(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/files`);
}

export async function uploadFile(teamId, channelId, file, deepAnalysis = false) {
    const token = await getAccessToken();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("lang", getLang());
    formData.append("deepAnalysis", deepAnalysis ? "true" : "false");

    const response = await fetch(
        `${API_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/files`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        }
    );

    const data = await response.json();
    if (!response.ok && response.status !== 201 && response.status !== 207) {
        throw new Error(data.error || "Upload failed");
    }
    return data;
}

export async function getDocument(docId, channelId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}?channelId=${encodeURIComponent(channelId)}`);
}

export async function generateQuestions(docId, channelId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}/generate-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, lang: getLang() }),
    });
}

export async function submitAnswer(docId, questionId, channelId, answer, answeredBy) {
    return apiRequest(
        `/documents/${encodeURIComponent(docId)}/questions/${encodeURIComponent(questionId)}/answer`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId, answer, answeredBy, lang: getLang() }),
        }
    );
}

export async function getDocumentRelationships(docId, channelId) {
    return apiRequest(
        `/documents/${encodeURIComponent(docId)}/relationships?channelId=${encodeURIComponent(channelId)}`
    );
}

export async function getChannelGraph(channelId) {
    return apiRequest(`/channels/${encodeURIComponent(channelId)}/graph`);
}

export async function completeQuestions(docId, channelId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}/complete-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
    });
}

export async function updateAnswer(docId, questionId, channelId, answer, answeredBy) {
    return apiRequest(
        `/documents/${encodeURIComponent(docId)}/questions/${encodeURIComponent(questionId)}/answer`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId, answer, answeredBy }),
        }
    );
}

export async function deleteDocument(docId, channelId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}?channelId=${encodeURIComponent(channelId)}`, {
        method: "DELETE",
    });
}
