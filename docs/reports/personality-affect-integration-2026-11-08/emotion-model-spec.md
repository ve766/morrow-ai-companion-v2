# 多维情绪模型规格

## 表示

每个 `EmotionInstance` 至少包含：

- `emotionId`、`family`、`intensity[0,1]`、`valence[-1,1]`、`arousal[0,1]`
- `onsetAt`、`lastUpdatedAt`、`decayProfile.halfLifeHours`
- `sourceKind`：`morrow_self_appraisal` / `user_context` / `shared_interaction` / `system_evidence`
- `appraisal`：G/C/N/A/S/R/L/E
- `confidence`、`uncertainty`、`evidenceRefs`（message id + role）
- `regulationState`：`active/fading/regulated/superseded/retracted`
- `schemaVersion=1`、`algorithmVersion=affect-appraisal-v1`

不保存原始对话全文；只保存 message id 与 topic tags（截断 48 字符）。

## 情绪族与半衰期

| 类型 | 分类 | valence | arousal | 半衰期(h) |
|---|---|---|---|---|
| joy | basic | .78 | .60 | 8 |
| anger | basic | -.72 | .82 | 3 |
| sadness | basic | -.72 | .30 | 72 |
| fear | basic | -.76 | .86 | 6 |
| disgust | basic | -.66 | .60 | 12 |
| surprise | basic | .08 | .76 | 0.5 |
| contentment | compound | .62 | .24 | 24 |
| excitement | compound | .82 | .82 | 4 |
| curiosity | compound | .42 | .56 | 36 |
| anticipation | compound | .44 | .50 | 12 |
| disappointment | compound | -.46 | .38 | 24 |
| frustration | compound | -.60 | .72 | 12 |
| relief | compound | .56 | .26 | 8 |
| regret | compound | -.50 | .44 | 48 |
| loneliness | compound | -.60 | .30 | 72 |
| gratitude | compound | .66 | .34 | 24 |
| trust | compound | .56 | .30 | 168 |
| concern | compound | -.36 | .56 | 24 |

`registerEmotionProfile` 可在运行时注册新 profile；`EMOTION_PROFILE_VERSION='emotion-taxonomy-v1'`。当前没有 UI 编辑器。

## Appraisal

八分量：

- G goal relevance，[0,1]
- C goal congruence，[-1,1]
- N novelty，[0,1]
- A agency/control，[0,1]
- S certainty，[0,1]
- R responsibility，[0,1]
- L relationship relevance，[0,1]
- E expectation gap，[0,1]

权重（`APPRAISAL_WEIGHTS_VERSION='appraisal-weights-v1'`）：

```text
G .20  C .25  N .10  A .10  S .05  R .10  L .10  E .10
P_e = Σ w_i x_i
I_e = clip(sigmoid(P_e) * Q_e * D_e)
```

- `Q_e`：本轮读取 confidence（规则强度，不是校准概率）。
- `D_e`：morrow_self_appraisal/system_evidence = 1.0；shared_interaction = 0.8；user_context = 0.6。
- `I_e` 只缩放候选强度（`intensity * (0.55 + 0.9*I_e)`），不做晋升，不直接改人格。
- 权重是代码内常量；没有在线校准或外部配置。报告不把任何值称为概率。

## 候选映射（规则，不是唯一效价）

- 正向反馈 + 高 G + 高 A：joy；低 arousal/重复：contentment；高 N：excitement；高 L：gratitude；重复正向：trust；之前的负向后转正：relief。
- 负向/纠错 + 高 R + 高 A：frustration；R 低：disappointment；高 R：regret；G 高且 S 低：concern；重复 frustration + S 高 + E 高：偶发 anger 候选。
- 探索/规划 + N 高 + A 高：curiosity；规划/中等 E：anticipation。
- 不确定 + 高 G + 低 A：concern；普通未知不产生 fear。
- Morrow-owned loss：invalidated interest/relationship → sadness/loneliness；knowledge gap → concern（不产生悲伤）。
- verified progress：joy/contentment；之前有负向时 relief。
- surprise：E 高 + N 高。

## 边界与防误判

- 先 `stripQuotedAndReportedText`，引用/转述不成为 Morrow 情绪证据。
- 用户说“我很难过”只产生 `sourceKind=user_context` 的弱 concern（且需要关系相关性）；不会产生 Morrow sadness。
- 短感谢只产生 joy，不是强情绪；礼貌拒绝不产生负向。
- 讽刺/反问不靠单关键词；显式反馈识别仍由既有 feeling engine 完成。
- assistant 自己生成的文本不作为外部事实或用户情绪证据；trait 只从结构化 appraisal 证据写入。
- low confidence 候选保留在事件日志但不进入投影。
- 同族同主题重复事件合并，不叠加到 1.0；不同族可共存，冲突标记 `coexisting_affect`。

## 衰减、共存、调节

- 按 `halfLifeHours` 指数衰减；<0.03 移除；<0.12 标 `fading`。
- 同一 family/source/topic 合并；不同 family 共存，最多 16 个 active 实例。
- `regulate` 必须带 rationale，可选择 `reappraised/regulated/retracted`；时间流逝不会伪造“已解决”。
- 重建时会重放 events + regulations，retracted 不会被复活。
