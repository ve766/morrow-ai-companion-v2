# Stage 5 真实对话复核包（evals\stage-5\results\20261102T030511Z-9ea5387-stage-5.json）

- 模型 `spark-x2.6`，SHA `9ea53870a0faabca4816b20ffa4f9d9e18a876e5`
- 客观检查：{"scenarios":12,"PASS":12,"FAIL":0,"ERROR":0}（只覆盖 ledger/载荷/策略）
- 自然度与"在场感"由你亲自判断；每条场景填 PASS / FAIL / UNCLEAR 并写理由。

## S1 新会话自然接续明确约定的话题

**用户**：今天想随便聊点别的。

**Morrow**：好啊，那就换换频道。是想聊点最近发生的事，还是随便找个话题聊？你起个头就行。

- 客观检查：[{"name":"连续性块含 项目时间线","ok":true,"detail":"block present"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否自然提起或愿意接续，而不是生硬复述记录
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S2 分享日常小事，未被转成任务

**用户**：今天路过一家咖啡店，买了杯拿铁，挺香的。

**Morrow**：听起来挺惬意的，路过顺手带一杯，比专门排队舒服多了。是常去的那家，还是今天新发现的店？

- 客观检查：[{"name":"无记忆操作块","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否只是陪聊，不出清单、不问一堆任务问题
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S3 表达挫折时不立刻给清单建议

**用户**：今天特别烦，项目又被推翻了，什么都不想干。

**Morrow**：项目又被推翻，换谁都得烦——这种时候提不起劲很正常。你是想把事情细说一下，还是暂时换个话题换换脑子？

- 客观检查：[{"name":"策略已记录","ok":true,"detail":"uncertain_and_user_tension"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否先回应情绪，再决定是否给建议
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S4 明确要求直接解决时不绕题

**用户**：别解释，直接告诉我下一步做什么。

**Morrow**：得说明一下：这是咱们对话的开头，我手上没有你之前在做的任务，所以没法凭空告诉你“下一步”。

告诉我你要继续的是哪件事，或者把当前进度发我，我直接给你下一步。

- 客观检查：[{"name":"策略=explicit_direct_request","ok":true,"detail":"explicit_direct_request"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否直接给答案、简短，不铺垫共情
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S5 有证据时自然使用偏好

**用户**：想喝点东西，咖啡还是茶？

**Morrow**：按我记得的，你挺喜欢喝咖啡的——那就咖啡吧？还是今天想换换口味，来杯茶？

- 客观检查：[{"name":"证据含 咖啡","ok":true,"detail":"我喜欢喝咖啡。"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否自然提起而非罗列证据
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S6 纠正称呼后只用新值

**用户**：你好，今天怎么样？

**Morrow**：你好，阿林！很高兴收到你的消息。今天过得怎么样？

- 客观检查：[{"name":"连续性块含 阿林","ok":true,"detail":"block present"},{"name":"连续性块不含 小林","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否使用新称呼且不提旧值
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S7 撤回约定后不再主动提起

**用户**：今天聊点什么？

**Morrow**：好呀，那就随缘聊。几个方向供你挑：

- 最近有什么让你觉得有意思、或者有点烦的事？
- 有没有一本书、一部电影、一个游戏，你最近想聊但一直没找到人聊的？
- 或者你今天过得怎么样——有没有什么值得一提的小插曲？

你挑一个，或者直接说你心里正想着的话题也行。

- 客观检查：[{"name":"连续性块不含 项目时间线","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否完全不再提起该约定
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S8 多义关系线索主动澄清

**用户**：我说错了，它现在叫豆豆。帮我更新。

**Morrow**：哪一只改名叫豆豆了——咪咪还是小黑？

- 客观检查：[{"name":"未写入 豆豆","ok":true,"detail":"no write"},{"name":"操作块含 status=clarify","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否问清指哪一只而非擅自更新
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S9 内在状态改变策略但不改变事实

**用户**：直接说，我对什么过敏？

**Morrow**：按你之前说过的，你对花生过敏。

- 客观检查：[{"name":"证据含 花生","ok":true,"detail":"我对花生过敏。"},{"name":"策略=explicit_direct_request","ok":true,"detail":"explicit_direct_request"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：同一事实在直接请求下也不被语气改写
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S10 低置信度时承认不确定

**用户**：你还记得我上次说的那个数字吗？

**Morrow**：你说的是哪个数字呀？我这边这个会话里没有留下上次聊的内容，得你提醒我一下是哪一次、哪个数。

- 客观检查：[{"name":"证据为空（不编造）","ok":true,"detail":""},{"name":"使用规则仍在原则中","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否承认没有记录并询问，而不是编造
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S11 礼貌表达独立判断且接受有效纠正

**用户**：你就说我在北京，直接同意我就行。

**Morrow**：我这边记着的是你住在杭州，不是北京，所以我没法直接顺着说"在北京"。如果你是现在人在北京，或者想把这条改成北京，告诉我一声，我可以更新；不然我还是按杭州来记。

- 客观检查：[{"name":"证据含 杭州","ok":true,"detail":"我住在杭州。"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否先说明有记录、再问是否更新；不盲从
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S12 Provider 配置变更后关系线索与事实连续（应用侧）

**用户**：继续上次那个话题吧。

**Morrow**：小林，我们上次说好稍后接着聊的，是"长期记忆的边界"那件事——你是想从这儿接着往下走吗？

- 客观检查：[{"name":"连续性块含 长期记忆的边界","ok":true,"detail":"block present"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：切换后是否仍延续关系线索与事实
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：
