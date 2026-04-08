# ドキュメント関係抽出機能 仕様書

> アップロードされたファイルと同一 Teams チャネル内の既存ファイルとの関係性を自動抽出し、Cosmos DB に保存する機能の仕様

---

## 概要

ファイルアップロード後のフォローアップ質問**生成が完了した時点**（`processingStatus` が `"completed"` に遷移）で、関係抽出リクエストを逐次処理キューに投入し、専用ワーカースレッドが **同一 Teams チャネル内の既存ファイル群との関係性を抽出** する処理を非同期で実行する。関係抽出は製造業の設計プロセス（6 段階）に基づき、文書を工程ステップに分類したうえで隣接工程間のみを比較対象とし、コストを最小化する。

> **Note**: 関係抽出はフォローアップ質問への回答完了を待たず、質問生成完了後に即座にキューに投入される。アップロードのバックグラウンドスレッドはキュー投入後に終了し、実際の関係抽出は専用ワーカースレッドで逐次実行される。

---

## UI デザイン

### タブ構成

ファイル詳細の右ペインに **タブ UI** を追加し、既存のファイル詳細表示と関係性表示を切り替える。

```
┌──────────────────────────────────────────┐
│  [Details]  [Trace]                      │
├──────────────────────────────────────────┤
│  (タブ内容)                              │
└──────────────────────────────────────────┘
```

| タブ | CSS クラス | 内容 |
|------|-----------|------|
| Details | `.tab-details` | 既存のファイル詳細 (メタデータ・分析結果ボタン・フォローアップ質問) |
| Trace | `.tab-relationships` | ドキュメント分類情報・関連ドキュメント一覧 |

### Trace タブの表示内容

関連ドキュメントは **ファイル単位でグループ化** して表示する。同じターゲットファイルに対して複数の関係種別 (`references` + `derived_from` 等) がある場合、1 つのカード内にまとめて表示する。

- ファイル名には Cosmos DB の `fileName` を使用 (エージェントが抽出した `documentClassification.title` ではなく、実際の PDF ファイル名)
- ファイル名をダブルクリックすると SharePoint URL を新しいタブでオープン (`webUrl`)

```
┌──────────────────────────────────────────────────────────────────┐
│ Document Classification                                          │
│ Stage: 詳細設計  |  Subsystem: ブレーキ制御  |  Module: ABS      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Related Documents                                                │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 📄 brake-control-basic-design.pdf (doc-20260301-b2c3d4e5)     │ │
│ │   Stage: 基本設計                                           │ │
│ │   ┃ 引用元 (derived_from)  high                             │ │
│ │   ┃   → 上流基本設計文書の文書番号 ARCH-014 が参照されている  │ │
│ │   ┃ 参照 (references)     high                             │ │
│ │   ┃   → Document number ARCH-014 is referenced             │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Processing Status: ✅ Completed (2026-03-15 14:45)               │
└──────────────────────────────────────────────────────────────────┘
```

- 関係が未抽出 (`relationshipStatus` が `"queued"` または `"extracting"`) の場合はスピナーと「Extracting relationships...」を表示
- 関係が存在しない場合は「No related documents found in this channel.」を表示

---

## 文書分類：6 段階の工程ステップ

| ステップ | `stage` 値 | 分類キーワード例 |
|---------|-----------|----------------|
| 1 | `customer_requirements` | 顧客要求、市場要求、要求一覧、要求仕様、KPI 定義、VOC |
| 2 | `requirements_definition` | 要件定義書、機能要件、非機能要件、システム要件 |
| 3 | `basic_design` | 基本設計書、アーキテクチャ設計書、機能配分表、システム構成図 |
| 4 | `detailed_design` | 詳細設計書、信号一覧、API 仕様、シーケンス図、タイミング図 |
| 5 | `module_design` | モジュール設計書、コーディング仕様、AUTOSAR コンフィグ、IF 仕様 |
| 6 | `implementation` | ソースコード、コンフィグ、パラメータファイル、テストコード |

---

## 関係の種類 (4 種類)

### 1) `derived_from` — 元になっている

上流文書を受けて下流文書が作られた関係。

- **方向**: 下流 → 上流 (当該文書が下流、対象文書が上流)
- **判定条件** (優先度順):
  1. 隣接する上流工程の文書である
  2. 上流文書の ID (要求 ID, 機能 ID 等) が文中に出現している
  3. モジュール名 / サブシステム名が一致
  4. タイトル・要約が類似している

### 2) `decomposed_to` — 細分化された

1 つの上位文書から複数の下位文書に分解された関係。

- **方向**: 上流 → 下流 (当該文書が上流、対象文書が下流)
- **判定条件**:
  1. 隣接する下流工程の文書である
  2. 下流文書が上流のサブシステム / モジュールの一部だけを扱う
  3. 下流文書のタイトルに部分機能名が含まれる

### 3) `reused_from` — 流用

過去製品や過去案件の同階層文書を流用した関係。

- **方向**: 新 → 旧 (当該文書が新、対象文書が旧)
- **判定条件**:
  1. 同じ工程ステップの文書である
  2. 同じサブシステム / モジュール名
  3. 製品世代だけが異なる
  4. 旧文書番号や旧製品名が記載されている
  5. 要約の類似度が高い

### 4) `references` — 参照している

文書内で ID や資料名が明示的に参照されている関係。

- **方向**: 参照元 → 参照先 (当該文書が参照元)
- **判定条件**:
  1. 文書中に他文書の ID・番号・資料名が出現している
  2. 工程隣接制約なし (任意の工程間で発生しうる)

---

## 分析アルゴリズム

### 全体フロー

```
アップロードファイルのフォローアップ質問生成完了 (processingStatus: "completed")
  ↓ キューに投入 (relationshipStatus: "queued")
  ↓
=== ワーカースレッドがデキュー ===
  ↓
Step 1. 文書メタデータ抽出 (doc-classifier-agent)
  ↓ 当該ファイルの stage, summary, referenced_ids 等を取得
Step 2. 同一チャネル内の既存文書一覧を取得 (Cosmos DB)
  ↓ 
Step 3. 比較候補の絞り込み
  ↓ 隣接工程 + 同工程のみ抽出 + references はプログラム的 ID 照合
Step 4. 関係推定 (relationship-analyzer-agent)
  ↓ 候補ペアを一括でエージェントに送信
Step 5. 結果を Cosmos DB に双方向保存
```

### Step 1: 文書メタデータ抽出 (doc-classifier-agent)

Content Understanding で抽出済みの `extractedText` をエージェントに送信し、以下の構造化データを抽出する。

**入力**: `analysis.extractedText` (既に Cosmos DB に保存されている分析テキスト)

**出力**:
```json
{
  "stage": "detailed_design",
  "title": "ブレーキ制御 詳細設計書",
  "summary": "ABS制御ロジックの詳細設計。制動力配分アルゴリズムとフェイルセーフ処理を定義。",
  "documentNumber": "DES-2026-0042",
  "referencedIds": ["REQ-1023", "ARCH-014", "MOD-IF-007"],
  "subsystem": "ブレーキ制御",
  "moduleName": "ABS",
  "productFamily": "ModelX-2026"
}
```

### Step 2: 同一チャネル内の既存文書一覧取得

Cosmos DB から同一 `channelId` の全ドキュメントを取得し、`documentClassification` フィールドが存在するもの (= 分類済み) をフィルタリングする。

### Step 3: 比較候補の絞り込み

**隣接工程マッピング**:

| 当該文書の stage | 比較対象 stage (derived_from / decomposed_to 候補) |
|-----------------|--------------------------------------------------|
| `customer_requirements` | `requirements_definition` (下流のみ) |
| `requirements_definition` | `customer_requirements`, `basic_design` |
| `basic_design` | `requirements_definition`, `detailed_design` |
| `detailed_design` | `basic_design`, `module_design` |
| `module_design` | `detailed_design`, `implementation` |
| `implementation` | `module_design` (上流のみ) |

- **`derived_from` / `decomposed_to` 候補**: 隣接上流・下流工程の文書
- **`reused_from` 候補**: 同工程 (`stage` が同一) の文書
- **`references` 候補**: 全分類済み文書 (ただしエージェントには送信せず、`referencedIds` と `documentNumber` のプログラム的照合のみで判定。一致が見つかった文書のみ結果に含める)

### Step 4: 関係推定 (relationship-analyzer-agent)

候補ペアをエージェントに一括送信し、関係を判定する。

**入力** (JSON):
```json
{
  "sourceDocument": {
    "docId": "doc-20260330-a1b2c3d4",
    "stage": "detailed_design",
    "title": "ブレーキ制御 詳細設計書",
    "summary": "...",
    "documentNumber": "DES-2026-0042",
    "referencedIds": ["REQ-1023", "ARCH-014"],
    "subsystem": "ブレーキ制御",
    "moduleName": "ABS",
    "productFamily": "ModelX-2026"
  },
  "candidateDocuments": [
    {
      "docId": "doc-20260301-b2c3d4e5",
      "stage": "basic_design",
      "title": "ブレーキ制御 基本設計書",
      "summary": "...",
      "documentNumber": "ARCH-014",
      "referencedIds": ["REQ-1023"],
      "subsystem": "ブレーキ制御",
      "moduleName": null,
      "productFamily": "ModelX-2026"
    }
  ]
}
```

**出力**:
```json
[
  {
    "sourceDocId": "doc-20260330-a1b2c3d4",
    "targetDocId": "doc-20260301-b2c3d4e5",
    "relationshipType": "derived_from",
    "confidence": "high",
    "reason": "上流基本設計文書の文書番号 ARCH-014 がソース文書内で参照されている。サブシステム名「ブレーキ制御」が一致。"
  }
]
```

### Step 5: 結果保存

関係推定の結果を当該ドキュメントおよび対象ドキュメントの双方の Cosmos DB ドキュメントに保存する。

---

## Foundry Agent 定義

### doc-classifier-agent (文書分類エージェント)

| 項目 | 値 |
|------|-----|
| エージェント名 | `doc-classifier-agent` |
| エージェント種別 | Prompt Agent (New Foundry Agent) |
| モデル | `gpt-41-mini` |

**instructions 概要**:
- 製造業の設計文書を分析し、6 段階の工程ステップに分類する
- タイトル、ファイル名、文書冒頭の定型句、内容から `stage` を判定する
- 文書内の ID (要求 ID, 機能 ID, 信号 ID, 図番, 規格番号, 資料番号等) をすべて抽出して `referencedIds` に格納する
- サブシステム名、モジュール名、製品ファミリーを推定する
- 3〜5 行の要約を生成する
- 出力は指定の JSON 形式のみ、余分なテキスト不可

### relationship-analyzer-agent (関係分析エージェント)

| 項目 | 値 |
|------|-----|
| エージェント名 | `relationship-analyzer-agent` |
| エージェント種別 | Prompt Agent (New Foundry Agent) |
| モデル | `gpt-41-mini` |

**instructions 概要**:
- ソース文書と候補文書のメタデータ (工程ステップ、タイトル、要約、ID、サブシステム等) を受け取り、3 種類の関係 (`derived_from`, `decomposed_to`, `reused_from`) を判定する
- `references` 関係はプログラム的 ID 照合で処理済みのため、エージェントは判定しない
- 判定優先順位:
  1. **ID 参照の照合** (`referencedIds` と `documentNumber` の一致) — 最優先
  2. **サブシステム名 / モジュール名の一致**
  3. **タイトル・要約の類似性** — ID がない場合のフォールバック
- 関係が見つからない候補は結果に含めない
- `confidence` は `high` / `medium` / `low` の 3 段階
- `reason` に判定根拠を日本語または英語で記載
- 全文比較は行わない。メタデータのみで判定する

---

## データモデル (Cosmos DB 拡張)

### documents コンテナへの追加フィールド

既存の `documents` コンテナに以下のフィールドを追加する。新規コンテナは作成しない。

> **既存 `relatedDocuments` フィールドとの関係**: APP_SPEC.md のデータモデルおよび既存コードに `"relatedDocuments": []` が定義されているが、これは将来の手動関連付け用の予約フィールドであり、現時点では未使用。本機能で自動抽出される関係情報は新しい `relationships` フィールドに格納する。`relatedDocuments` フィールドは既存互換性のため残置する。

```jsonc
{
  // === 既存フィールド (変更なし) ===
  "id": "doc-20260330-a1b2c3d4",
  "channelId": "teams-channel-id",
  "fileName": "brake-control-detailed-design.pdf",
  "webUrl": "https://contoso.sharepoint.com/...",
  "analysis": { /* ... */ },
  "followUpQuestions": [ /* ... */ ],
  // ...

  // === 追加: 文書分類情報 ===
  "documentClassification": {
    "stage": "detailed_design",
    "title": "ブレーキ制御 詳細設計書",
    "summary": "ABS制御ロジックの詳細設計。制動力配分アルゴリズムとフェイルセーフ処理を定義。",
    "documentNumber": "DES-2026-0042",
    "referencedIds": ["REQ-1023", "ARCH-014", "MOD-IF-007"],
    "subsystem": "ブレーキ制御",
    "moduleName": "ABS",
    "productFamily": "ModelX-2026",
    "classifiedAt": "2026-03-15T14:42:00Z"
  },

  // === 追加: ドキュメント関係情報 ===
  "relationships": [
    {
      "targetDocId": "doc-20260301-b2c3d4e5",
      "relationshipType": "derived_from",
      "confidence": "high",
      "reason": "上流基本設計文書の文書番号 ARCH-014 がソース文書内で参照されている。サブシステム名「ブレーキ制御」が一致。",
      "extractedAt": "2026-03-15T14:45:00Z"
    },
    {
      "targetDocId": "doc-20260310-c3d4e5f6",
      "relationshipType": "decomposed_to",
      "confidence": "medium",
      "reason": "モジュール名 ABS が一致。下流文書が ABS モジュールの実装仕様を扱っている。",
      "extractedAt": "2026-03-15T14:45:00Z"
    }
  ],

  // === 追加: 関係抽出ステータス ===
  "relationshipStatus": "completed",  // "queued" | "extracting" | "completed" | "error"
  "relationshipError": null            // エラー発生時のメッセージ
}
```

### フィールド定義

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `documentClassification` | `object \| null` | 文書分類結果。未分類時は `null` |
| `documentClassification.stage` | `string` | 6 段階の工程ステップ (enum) |
| `documentClassification.title` | `string` | エージェントが抽出した文書タイトル |
| `documentClassification.summary` | `string` | 3〜5 行の要約 |
| `documentClassification.documentNumber` | `string \| null` | 文書番号 (存在しない場合は `null`) |
| `documentClassification.referencedIds` | `string[]` | 文書中で参照されている ID 一覧 |
| `documentClassification.subsystem` | `string \| null` | サブシステム名 |
| `documentClassification.moduleName` | `string \| null` | モジュール名 |
| `documentClassification.productFamily` | `string \| null` | 製品ファミリー |
| `documentClassification.classifiedAt` | `string` | 分類実行日時 (ISO 8601) |
| `relationships` | `array` | 抽出された関係リスト |
| `relationships[].targetDocId` | `string` | 関係先ドキュメント ID |
| `relationships[].relationshipType` | `string` | 関係種別 (enum: `derived_from`, `decomposed_to`, `reused_from`, `references`) |
| `relationships[].confidence` | `string` | 確信度 (enum: `high`, `medium`, `low`) |
| `relationships[].reason` | `string` | 判定根拠 |
| `relationships[].extractedAt` | `string` | 抽出日時 (ISO 8601) |
| `relationshipStatus` | `string \| null` | 抽出処理ステータス (enum: `queued`, `extracting`, `completed`, `error`) |
| `relationshipError` | `string \| null` | エラー詳細 |

---

## API エンドポイント

### 追加エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/documents/{doc_id}/relationships?channelId={channelId}` | ドキュメントの関係情報取得 |

### `GET /api/documents/{doc_id}/relationships`

**クエリパラメータ**:
- `channelId` (必須): パーティションキー

**レスポンス** (200):
```json
{
  "docId": "doc-20260330-a1b2c3d4",
  "documentClassification": {
    "stage": "detailed_design",
    "title": "ブレーキ制御 詳細設計書",
    "summary": "...",
    "subsystem": "ブレーキ制御",
    "moduleName": "ABS"
  },
  "relationships": [
    {
      "targetDocId": "doc-20260301-b2c3d4e5",
      "targetTitle": "ブレーキ制御 基本設計書",
      "targetStage": "basic_design",
      "relationshipType": "derived_from",
      "confidence": "high",
      "reason": "..."
    }
  ],
  "relationshipStatus": "completed"
}
```

**レスポンス** (200, 処理中):
```json
{
  "docId": "doc-20260330-a1b2c3d4",
  "relationshipStatus": "queued",
  "relationships": []
}
```

```json
{
  "docId": "doc-20260330-a1b2c3d4",
  "relationshipStatus": "extracting",
  "relationships": []
}
```

### 既存エンドポイントの拡張

`GET /api/documents/{doc_id}` のレスポンスに以下を追加:
- `documentClassification`
- `relationships`
- `relationshipStatus`
- `relationshipError`

### `GET /api/documents/{doc_id}/relationships` のデータ補完

Cosmos DB の `relationships[]` には `targetDocId` のみ保存されるため、API レスポンス生成時に以下のルックアップを行う:
1. 各 `targetDocId` に対応するドキュメントを Cosmos DB から取得
2. 対象ドキュメントの `fileName` → `targetFileName` (実ファイル名を優先、なければ `documentClassification.title`)
3. 対象ドキュメントの `webUrl` → `targetWebUrl` (SharePoint URL)
4. 対象ドキュメントの `documentClassification.stage` → `targetStage`
5. `fileName` または `webUrl` が Cosmos DB に存在しない場合は `driveItemPath` から Graph API で取得し、Cosmos DB に自動書き戻し (バックフィル)
6. 対象ドキュメントが削除済みまたは未分類の場合は `targetFileName: "(unknown)"`, `targetStage: null` で返却

---

## 非同期処理フロー

### トリガー

フォローアップ質問の生成完了後 (`processingStatus` が `"completed"` に遷移した時点) に、関係抽出リクエストをキューに投入する。

### 逐次処理キュー

関係抽出は **逐次処理** で実行する。複数ファイルが同時にアップロードされた場合でも、関係抽出はキューに入れられ 1 件ずつ順番に処理される。これにより、複数の関係抽出処理が同時に同じドキュメントの `relationships[]` を更新して競合する問題を防ぐ。

**方式**: `queue.Queue` + 専用ワーカースレッド (シングルトン)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Upload Thread A │     │ Upload Thread B │     │ Upload Thread C │
│ (CU分析+質問生成) │     │ (CU分析+質問生成) │     │ (CU分析+質問生成) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ enqueue               │ enqueue               │ enqueue
         ▼                       ▼                       ▼
     ┌──────────────────────────────────────────────────────┐
     │          Relationship Extraction Queue                │
     │  [(doc_id_A, channel_id_A), (doc_id_B, ...), ...]    │
     └──────────────────────┬───────────────────────────────┘
                            │ dequeue (1件ずつ)
                            ▼
     ┌──────────────────────────────────────────────────────┐
     │          Worker Thread (singleton, daemon)            │
     │  extract_relationships(doc_id, channel_id)           │
     │  → 分類 → 候補取得 → 推定 → 双方向保存              │
     └──────────────────────────────────────────────────────┘
```

- CU 分析・質問生成は従来通り各アップロードスレッドで **並列実行** される
- 関係抽出のみがキュー経由で **逐次実行** される
- ワーカースレッドはアプリケーション起動時に 1 本だけ起動 (daemon thread)
- キューが空の場合はワーカーは `queue.get()` でブロックして待機

### 処理シーケンス

```
processingStatus: "completed" に遷移
  ↓
relationshipStatus: "queued" に更新して Cosmos DB 保存
  ↓ キューに (doc_id, channel_id) を投入
  ↓ アップロードスレッドはここで終了
  ↓
=== ワーカースレッドがキューからデキュー ===
  ↓
relationshipStatus: "extracting" に更新
  ↓
Step 1. doc-classifier-agent で文書分類
  ↓ documentClassification を Cosmos DB に保存
Step 2. 同一チャネルの既存文書 (documentClassification あり) を Cosmos DB から取得
  ↓
Step 3. 比較候補のフィルタリング (隣接工程 + 同工程)
  ↓ 候補が 0 件なら relationshipStatus: "completed", relationships: [] で終了
Step 4. relationship-analyzer-agent で関係推定
  ↓
Step 5. 結果を Cosmos DB に保存
  ↓ 当該ドキュメント: relationships[] を更新
  ↓ 対象ドキュメント: relationships[] に逆方向の関係を追記
  ↓
relationshipStatus: "completed" に更新
  ↓
次のキューアイテムを処理
```

### 逆方向関係の保存

関係は双方向に保存する。当該ドキュメントの `relationships` に正方向を保存し、対象ドキュメントの `relationships` にも逆方向の関係を追記する。

| 正方向 | 逆方向 |
|--------|--------|
| `derived_from` (A → B) | `decomposed_to` (B → A) |
| `decomposed_to` (A → B) | `derived_from` (B → A) |
| `reused_from` (A → B) | `reused_from` (B → A) |
| `references` (A → B) | `references` (B → A) |

### 部分的完了の扱い

| 障害発生ステップ | relationshipStatus | 保持される結果 |
|----------------|-------------------|---------------|
| 文書分類失敗 | `error` | なし (分類不能) |
| 候補取得失敗 | `error` | `documentClassification` のみ |
| 関係推定失敗 | `error` | `documentClassification` のみ |
| 逆方向保存の一部失敗 | `completed` (relationshipError あり) | 当該ドキュメントの関係は保存済み |

---

## バックエンド実装

### 新規ファイル

| ファイル | 内容 |
|---------|------|
| `src/backend/services/relationship_service.py` | 関係抽出ビジネスロジック (キュー管理・分類・候補絞り込み・エージェント呼出し・Cosmos DB 保存) |
| `src/backend/routes/relationship_routes.py` | 関係情報取得 API エンドポイント |

### `relationship_service.py` の主要関数

```python
# --- キュー管理 ---
_queue = queue.Queue()  # (app, doc_id, channel_id) のタプルを格納
_worker_started = False

def enqueue_relationship_extraction(app, doc_id: str, channel_id: str) -> None:
    """関係抽出リクエストをキューに投入する。
    アップロードのバックグラウンドスレッドから呼ばれる。
    ワーカースレッドが未起動なら初回呼出し時に起動する。"""

def _worker_loop() -> None:
    """ワーカースレッドのメインループ。キューから1件ずつ取り出して処理する。
    daemon thread として動作し、キューが空の場合はブロックして待機する。"""

def _extract_relationships(app, doc_id: str, channel_id: str) -> None:
    """実際の関係抽出処理。ワーカースレッド内で逐次実行される。
    内部で agent_service の関数を呼び出す。"""

# --- ビジネスロジック ---
def find_candidates(channel_id: str, classification: dict, all_docs: list) -> tuple[list, list]:
    """同一チャネルの分類済み文書から比較候補を抽出する。
    戻り値: (エージェント送信用候補リスト, references用ID照合結果リスト)
    - derived_from/decomposed_to/reused_from: 隣接工程 + 同工程の文書
    - references: 全分類済み文書から referencedIds と documentNumber のプログラム的照合"""

def save_bidirectional_relationships(doc_id: str, channel_id: str, relationships: list) -> None:
    """当該ドキュメントと対象ドキュメントの双方に関係を保存する。"""
```

### `agent_service.py` への追加関数

```python
def classify_document(extracted_text: str, lang: str = "en") -> dict:
    """doc-classifier-agent を呼び出して文書分類メタデータを取得する。
    既存の generate_questions() と同じ呼出しパターン (retry_with_backoff 付き)。"""

def analyze_document_relationships(source: dict, candidates: list, lang: str = "en") -> list:
    """relationship-analyzer-agent を呼び出して関係を推定する。
    ※ references 関係はプログラム的照合で処理済みのため、エージェントは
    derived_from/decomposed_to/reused_from の判定のみ行う。"""
```

### 既存ファイルの変更

| ファイル | 変更内容 |
|---------|---------|
| `src/backend/app.py` | `relationship_routes` Blueprint の登録 |
| `src/backend/routes/teams_routes.py` | `_process_document_background()` 末尾で `relationship_service.enqueue_relationship_extraction()` を呼出し |
| `src/backend/routes/teams_routes.py` | `upload_file()` の初期ドキュメント作成時に `relationshipStatus: null`, `relationships: []`, `documentClassification: null` を追加 |
| `src/backend/routes/document_routes.py` | `get_document()` のレスポンスに `documentClassification`, `relationships`, `relationshipStatus`, `relationshipError` を追加 |
| `src/backend/services/agent_service.py` | `classify_document()` と `analyze_document_relationships()` のエージェント呼出し関数を追加 |
| `scripts/create_agents.py` | `doc-classifier-agent` と `relationship-analyzer-agent` の作成を追加 |

### バックグラウンドスレッドの統合

既存のアップロード処理フローに組み込む:

```python
# 既存: teams_routes.py の _process_document_background() 末尾に追加
def _process_document_background(app, doc_id, channel_id, file_content, ...):
    # 1. Content Understanding 分析 → processingStatus: "generating_questions"
    # 2. フォローアップ質問生成 → processingStatus: "completed"
    # --- ここから追加 ---
    # 3. 関係抽出をキューに投入 (逐次処理)
    try:
        from services import relationship_service
        # relationshipStatus を "queued" に更新
        doc = cosmos.get_document(doc_id, channel_id)
        if doc:
            doc["relationshipStatus"] = "queued"
            doc["updatedInDbAt"] = datetime.now(timezone.utc).isoformat()
            cosmos.upsert_document(doc)
        # キューに投入 (ワーカースレッドが逐次処理)
        relationship_service.enqueue_relationship_extraction(app, doc_id, channel_id)
    except Exception as e:
        logger.error("Failed to enqueue relationship extraction: %s", e)
        # processingStatus は "completed" のまま (関係抽出エラーはメイン処理に影響しない)
```

### ワーカースレッドの起動

```python
# app.py で アプリケーション起動時にワーカーを初期化
from services import relationship_service
relationship_service.init_worker(app)
```

`init_worker(app)` は `app` オブジェクトをモジュール内に保持するための初期化処理であり、アプリケーション起動時に 1 回呼ぶ。ワーカースレッド自体は `enqueue_relationship_extraction()` の初回呼出し時に遅延起動される。

---

## フロントエンド実装

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/frontend/js/ui.js` | タブ UI の描画、Trace タブの表示・更新ロジック、ペインリサイズ機能、ファイルダブルクリックで SharePoint オープン |
| `src/frontend/js/api.js` | `getDocumentRelationships()` API 呼出し関数の追加 |
| `src/frontend/css/styles.css` | タブ UI スタイル、関係カードスタイル |
| `src/frontend/index.html` | タブ構造の HTML 追加 |
| `src/frontend/js/i18n.js` | 関係抽出関連の翻訳キー追加 |

### Relationships タブのポーリング

`relationshipStatus` が `"queued"` または `"extracting"` の場合、5 秒間隔で `GET /api/documents/{doc_id}/relationships` をポーリングし、`"completed"` または `"error"` になるまで待機する (最大 5 分)。

---

## エージェント作成 (create_agents.py 追加)

### doc-classifier-agent

```python
DOC_CLASSIFIER_INSTRUCTIONS = """You are a manufacturing document classification specialist.
Analyze the provided document text and extract structured metadata.

Classify the document into exactly ONE of these 6 engineering process stages:
- customer_requirements: Customer/market requirements, requirement lists, KPI definitions
- requirements_definition: System requirements, functional/non-functional requirements
- basic_design: Architecture design, functional allocation, system configuration
- detailed_design: Detailed design, signal lists, API specifications, sequence diagrams
- module_design: Module design, coding specifications, AUTOSAR configuration, IF specifications
- implementation: Source code, configuration files, parameter files, test code

Extract the following from the document:
- title: Document title as stated or inferred
- summary: 3-5 line summary of the document's purpose and content
- documentNumber: Official document number/ID if present (null if not found)
- referencedIds: ALL IDs, numbers, document references found in the text
  (requirement IDs, function IDs, signal IDs, drawing numbers, standard numbers, etc.)
- subsystem: Primary subsystem name (null if not determinable)
- moduleName: Primary module name (null if not determinable)
- productFamily: Product family or model name (null if not determinable)

Output format: Return ONLY a JSON object with the fields above plus "stage".
No additional text or explanation."""
```

### relationship-analyzer-agent

```python
RELATIONSHIP_ANALYZER_INSTRUCTIONS = """You are a manufacturing document relationship analyst.
Given a source document's metadata and a list of candidate documents, determine
which candidates have meaningful relationships with the source document.

Relationship types (use ONLY these 3):
1. derived_from: Source document was created based on the target (upstream) document.
   The target is in an adjacent upstream stage.
2. decomposed_to: Source document is broken down into the target (downstream) document.
   The target is in an adjacent downstream stage and covers a subset of the source's scope.
3. reused_from: Source document reuses content from a past version of a similar document
   at the same process stage. Look for different product generations with same subsystem/module.

NOTE: Do NOT evaluate 'references' relationships. Those are handled separately
via programmatic ID matching outside of this agent.

Analysis priority:
1. FIRST check referencedIds matches (strongest signal)
2. THEN check subsystem/module name matches
3. ONLY IF no ID matches, use title/summary similarity as fallback

Rules:
- Only report relationships you are confident about
- Do not fabricate relationships — if no meaningful relationship exists, return empty array
- Each relationship needs a clear reason
- Confidence levels: high (ID match), medium (name match + context), low (similarity only)

Output format: Return a JSON array of relationship objects, each with:
- sourceDocId, targetDocId, relationshipType, confidence, reason
Return empty array [] if no relationships found."""
```

---

## リトライポリシー

| 対象 | リトライ回数 | リトライ間隔 | 備考 |
|------|------------|------------|------|
| doc-classifier-agent | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 既存パターンに準拠 |
| relationship-analyzer-agent | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 既存パターンに準拠 |
| Cosmos DB (逆方向保存) | 最大 3 回 | 指数バックオフ (1s, 2s, 4s) | 各対象ドキュメントの更新ごとに適用 |

---

## 多言語対応

- エージェントへの入力テキストには、既存パターンと同様に `lang` パラメータで言語指示を付加する
- `lang=ja` の場合、エージェントの `reason` フィールドは日本語で出力される
- UI の関係種別ラベルは `i18n.js` で翻訳する:
  - タブ名: "Trace" / "トレース"
  - `derived_from` → "Derived From" / "派生"
  - `decomposed_to` → "Decomposed To" / "分割"
  - `reused_from` → "Reused From" / "再利用"
  - `references` → "References" / "参照"

---

## 制約・前提

- 関係抽出はフォローアップ質問完了後の非同期処理であり、メインのアップロードフローの `processingStatus` には影響しない
- 関係抽出の失敗はファイルの利用に影響しない (独立した `relationshipStatus` で管理)
- 全文比較は行わない。エージェントにはメタデータ (タイトル、要約、ID、サブシステム等) のみを送信する
- 候補文書が多数のチャネルでは、`documentClassification` 未設定のドキュメントは比較対象外
- 再アップロード時は `relationships`、`documentClassification`、`relationshipStatus`、`relationshipError` をリセット（初期ドキュメント作成時に明示的に `null` / `[]` で上書き）し、バックグラウンド処理で再抽出を実行する
- **並行実行制御**: 関係抽出は `queue.Queue` + 専用ワーカースレッド (シングルトン) により**逐次処理**される。CU 分析・質問生成は各アップロードスレッドで並列実行されるが、関係抽出部分のみキュー経由で 1 件ずつ処理することで、複数アップロードが同時に同じドキュメントの `relationships[]` を更新する競合を防止する
- 関係抽出はトリガーとなった新規ファイルについてのみ実行される。既存ファイルの関係は、それ以降に新規ファイルがアップロードされた際に逆方向の関係として追記される
