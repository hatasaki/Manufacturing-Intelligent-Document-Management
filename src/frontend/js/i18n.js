const translations = {
    en: {
        // Page title
        pageTitle: "Manufacturing Intelligent Document Management",
        // Login
        loginSubtitle: "Sign in with your Microsoft account to continue",
        loginButton: "Sign in with Microsoft",
        // Header
        channelPlaceholder: "Select a Teams Channel...",
        // File list
        filesHeader: "Files",
        noFilesPlaceholder: "No files in this channel",
        selectChannelPlaceholder: "Select a Teams channel to view files",
        selectFilePlaceholder: "Select a file to view details",
        // Drop zone
        dropZoneText: "Drag & drop PDF files here to upload",
        // File details
        labelCreated: "Created",
        labelCreatedBy: "Created By",
        labelLastModified: "Last Modified",
        labelLastModifiedBy: "Last Modified By",
        // Questions
        followUpQuestionsHeader: "Follow-up Questions",
        followUpQuestionsAndAnswers: "Follow-up Questions & Answers",
        noQuestionsYet: "No follow-up questions generated yet",
        badgeAnswered: "Answered",
        badgePending: "Not Available",
        // Modal chat
        questionProgress: "Question {current} of {total}",
        answerPlaceholder: "Type your answer...",
        btnSkip: "Skip",
        btnSend: "Send",
        labelYou: "You",
        labelAI: "AI",
        analyzingAnswer: "Analyzing your answer...",
        allQuestionsCompleted: "All Questions Completed",
        btnClose: "Close",
        // Upload
        uploadingMessage: "Uploading file to SharePoint...",
        analyzingDocument: "Analyzing document content...",
        generatingQuestions: "Generating follow-up questions...",
        uploadSuccess: "File uploaded successfully.",
        // Toast / error messages
        authInitFailed: "Authentication initialization failed. Check console for details.",
        loginFailed: "Login failed. Please try again.",
        loadChannelsFailed: "Failed to load channels. Please try again.",
        loadFilesFailed: "Failed to load files: {message}",
        loadDetailsFailed: "Failed to load file details.",
        noAnalysisData: "No analysis data available for this file",
        selectChannelFirst: "Please select a Teams channel first.",
        onlyPdfSupported: "Only PDF files are supported.",
        uploadFailed: "Upload failed: {message}",
        thankYouComplete: "Thank you for providing these valuable insights. Your expertise will help ensure the quality and completeness of this document.",
        thankYouDetailed: "Thank you for your detailed responses. Your input has been recorded.",
        answerAccepted: "Answer accepted. Moving to next question.",
        answerAnalysisUnavailable: "Answer analysis temporarily unavailable. Your answer has been saved.",
        // Deep Analysis toggle
        deepAnalysisLabel: "Deep Analysis",
        // Analysis modal
        btnShowAnalysis: "Analysis Results",

        analysisModel: "Model",
        analysisAnalyzedAt: "Analyzed At",
        analysisFigures: "Figures",
        analysisPage: "Page",
        analysisTables: "Tables",
        analysisTable: "Table",
        analysisKeyValuePairs: "Key-Value Pairs",
        analysisExtractedText: "Extracted Text",
        analysisModalTitle: "Analysis Results",
        // Relationship tab
        tabDetails: "Details",
        tabRelationships: "Trace",
        relDocClassification: "Document Classification",
        relStage: "Stage",
        relSubsystem: "Subsystem",
        relModule: "Module",
        relRelatedDocuments: "Related Documents",
        relNoRelationships: "No related documents found in this channel.",
        relExtracting: "Extracting relationships...",
        relExtractionFailed: "Relationship extraction failed",
        relConfidence: "Confidence",
        relUpstream: "Upstream (this file depends on)",
        relDownstream: "Downstream (depends on this file)",
        relDependsOn: "Depends On",
        relDependedBy: "Depended By",
        relRefersTo: "Refers To",
        relReferredBy: "Referred By",
        relNoUpstream: "No upstream dependencies found.",
        relNoDownstream: "No downstream dependencies found.",
        // Graph tab
        tabGraph: "Graph",
        graphFilterDependency: "Dependency",
        graphFilterReference: "Reference",
        graphFilterHigh: "High",
        graphFilterMedium: "Medium",
        graphFilterLow: "Low",
        graphNoData: "No relationship data available for graph.",
        relStageCustomerRequirements: "Customer Requirements",
        relStageRequirementsDefinition: "Requirements Definition",
        relStageBasicDesign: "Basic Design",
        relStageDetailedDesign: "Detailed Design",
        relStageModuleDesign: "Module Design",
        relStageImplementation: "Implementation",
        // Edit answer
        btnEditAnswer: "Edit",
        btnAddAnswer: "Answer",
        editAnswerPlaceholder: "Enter updated answer...",
        btnCancelEdit: "Cancel",
        btnSaveAnswer: "Save",
        saving: "Saving...",
        answerUpdateSuccess: "Answer updated and vectors refreshed.",
        answerUpdateFailed: "Failed to update answer: {message}",
        // Delete
        btnDeleteDocument: "Delete Document",
        deleteConfirmTitle: "Delete Document",
        deleteConfirmMessage: "Are you sure you want to delete this document? This will remove the file from SharePoint and all related data from the database. This action cannot be undone.",
        deleteConfirmOk: "Delete",
        deleteConfirmCancel: "Cancel",
        deleteSuccess: "Document has been deleted.",
        deleteFailed: "Failed to delete document: {message}",
        deleting: "Deleting...",
        // Date format locale
        dateLocale: "en-US",
    },
    ja: {
        // Page title
        pageTitle: "製造業インテリジェント文書管理",
        // Login
        loginSubtitle: "Microsoftアカウントでサインインしてください",
        loginButton: "Microsoftでサインイン",
        // Header
        channelPlaceholder: "Teamsチャンネルを選択...",
        // File list
        filesHeader: "ファイル",
        noFilesPlaceholder: "このチャンネルにはファイルがありません",
        selectChannelPlaceholder: "Teamsチャンネルを選択してファイルを表示",
        selectFilePlaceholder: "ファイルを選択して詳細を表示",
        // Drop zone
        dropZoneText: "PDFファイルをここにドラッグ＆ドロップしてアップロード",
        // File details
        labelCreated: "作成日",
        labelCreatedBy: "作成者",
        labelLastModified: "最終更新日",
        labelLastModifiedBy: "最終更新者",
        // Questions
        followUpQuestionsHeader: "フォローアップ質問",
        followUpQuestionsAndAnswers: "フォローアップ質問と回答",
        noQuestionsYet: "フォローアップ質問はまだ生成されていません",
        badgeAnswered: "回答済み",
        badgePending: "未回答",
        // Modal chat
        questionProgress: "質問 {current} / {total}",
        answerPlaceholder: "回答を入力...",
        btnSkip: "スキップ",
        btnSend: "送信",
        labelYou: "あなた",
        labelAI: "AI",
        analyzingAnswer: "回答を分析中...",
        allQuestionsCompleted: "すべての質問が完了しました",
        btnClose: "閉じる",
        // Upload
        uploadingMessage: "SharePointにファイルをアップロード中...",
        analyzingDocument: "ドキュメントの内容を分析中...",
        generatingQuestions: "フォローアップ質問を生成中...",
        uploadSuccess: "ファイルが正常にアップロードされました。",
        // Toast / error messages
        authInitFailed: "認証の初期化に失敗しました。コンソールで詳細を確認してください。",
        loginFailed: "ログインに失敗しました。もう一度お試しください。",
        loadChannelsFailed: "チャンネルの読み込みに失敗しました。もう一度お試しください。",
        loadFilesFailed: "ファイルの読み込みに失敗しました: {message}",
        loadDetailsFailed: "ファイル詳細の読み込みに失敗しました。",
        noAnalysisData: "このファイルの分析データはありません",
        selectChannelFirst: "先にTeamsチャンネルを選択してください。",
        onlyPdfSupported: "PDFファイルのみサポートされています。",
        uploadFailed: "アップロードに失敗しました: {message}",
        thankYouComplete: "貴重なご意見をいただきありがとうございます。あなたの専門知識がこの文書の品質と完全性の確保に役立ちます。",
        thankYouDetailed: "詳細なご回答をいただきありがとうございます。ご回答は記録されました。",
        answerAccepted: "回答が承認されました。次の質問に進みます。",
        answerAnalysisUnavailable: "回答の分析が一時的に利用できません。回答は保存されました。",
        // Deep Analysis toggle
        deepAnalysisLabel: "詳細分析",
        // Analysis modal
        btnShowAnalysis: "ファイルの分析結果",

        analysisModel: "モデル",
        analysisAnalyzedAt: "分析日時",
        analysisFigures: "図",
        analysisPage: "ページ",
        analysisTables: "テーブル",
        analysisTable: "テーブル",
        analysisKeyValuePairs: "キーと値のペア",
        analysisExtractedText: "抽出テキスト",
        analysisModalTitle: "ファイルの分析結果",
        // Relationship tab
        tabDetails: "詳細",
        tabRelationships: "トレース",
        relDocClassification: "文書分類",
        relStage: "工程",
        relSubsystem: "サブシステム",
        relModule: "モジュール",
        relRelatedDocuments: "関連ドキュメント",
        relNoRelationships: "このチャネルに関連ドキュメントは見つかりませんでした。",
        relExtracting: "関係を抽出中...",
        relExtractionFailed: "関係抽出に失敗しました",
        relConfidence: "確信度",
        relUpstream: "上流 (このファイルの依存先)",
        relDownstream: "下流 (このファイルに依存)",
        relDependsOn: "依存",
        relDependedBy: "被依存",
        relRefersTo: "参照",
        relReferredBy: "被参照",
        relNoUpstream: "上流の依存先は見つかりませんでした。",
        relNoDownstream: "下流の依存元は見つかりませんでした。",
        // Graph tab
        tabGraph: "グラフ",
        graphFilterDependency: "依存",
        graphFilterReference: "参照",
        graphFilterHigh: "High",
        graphFilterMedium: "Medium",
        graphFilterLow: "Low",
        graphNoData: "グラフ表示用の関係データがありません。",
        relStageCustomerRequirements: "顧客要求・市場要求",
        relStageRequirementsDefinition: "要件定義",
        relStageBasicDesign: "基本設計",
        relStageDetailedDesign: "詳細設計",
        relStageModuleDesign: "モジュール設計・実装準備",
        relStageImplementation: "実装",
        // Edit answer
        btnEditAnswer: "編集",
        btnAddAnswer: "回答する",
        editAnswerPlaceholder: "更新する回答を入力...",
        btnCancelEdit: "キャンセル",
        btnSaveAnswer: "保存",
        saving: "保存中...",
        answerUpdateSuccess: "回答が更新され、ベクトルデータが再生成されました。",
        answerUpdateFailed: "回答の更新に失敗しました: {message}",
        // Delete
        btnDeleteDocument: "ドキュメントを削除",
        deleteConfirmTitle: "ドキュメントの削除",
        deleteConfirmMessage: "このドキュメントを削除してもよろしいですか？SharePointからファイルが削除され、データベースからすべての関連データが削除されます。この操作は元に戻せません。",
        deleteConfirmOk: "削除",
        deleteConfirmCancel: "キャンセル",
        deleteSuccess: "ドキュメントが削除されました。",
        deleteFailed: "ドキュメントの削除に失敗しました: {message}",
        deleting: "削除中...",
        // Date format locale
        dateLocale: "ja-JP",
    },
};

let currentLang = localStorage.getItem("app-lang") || "en";

export function getLang() {
    return currentLang;
}

export function setLang(lang) {
    currentLang = lang;
    localStorage.setItem("app-lang", lang);
}

export function t(key, params = {}) {
    let text = translations[currentLang]?.[key] || translations.en[key] || key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
    }
    return text;
}
