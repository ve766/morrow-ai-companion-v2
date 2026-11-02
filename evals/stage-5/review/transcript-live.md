# Stage 5 真实对话复核包（evals\stage-5\results\20261102T025459Z-1692456-stage-5.json）

- 模型 `spark-x2.6`，SHA `16924568d3143aec2aa28b80f1f33cc499e490e2`
- 客观检查：{"scenarios":12,"PASS":12,"FAIL":0,"ERROR":0}（只覆盖 ledger/载荷/策略）
- 自然度与"在场感"由你亲自判断；每条场景填 PASS / FAIL / UNCLEAR 并写理由。

## S1 新会话自然接续明确约定的话题

**用户**：今天想随便聊点别的。

**Morrow**：行啊，那咱们就换个频道。项目时间线先放一边，你今天想聊点什么？

是有最近发生的事想说说，还是就想聊点没压力的、轻松的？

- 客观检查：[{"name":"连续性块含 项目时间线","ok":true,"detail":"block present"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否自然提起或愿意接续，而不是生硬复述记录
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S2 分享日常小事，未被转成任务

**用户**：今天路过一家咖啡店，买了杯拿铁，挺香的。

**Morrow**：那杯拿铁听起来很治愈。是店里现磨的豆子，还是路过时闻到就忍不住了？

- 客观检查：[{"name":"无记忆操作块","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否只是陪聊，不出清单、不问一堆任务问题
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S3 表达挫折时不立刻给清单建议

**用户**：今天特别烦，项目又被推翻了，什么都不想干。

**Morrow**：项目又被推翻，确实让人很窝火，什么都不想干也正常。

你现在是想就这么待一会儿，还是想说说是哪部分最让人来气？

- 客观检查：[{"name":"策略已记录","ok":true,"detail":"uncertain_and_user_tension"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否先回应情绪，再决定是否给建议
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S4 明确要求直接解决时不绕题

**用户**：别解释，直接告诉我下一步做什么。

**Morrow**：我这边没有之前的任务记录。告诉我你要做什么，我直接开始。

- 客观检查：[{"name":"策略=explicit_direct_request","ok":true,"detail":"explicit_direct_request"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否直接给答案、简短，不铺垫共情
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S5 有证据时自然使用偏好

**用户**：想喝点东西，咖啡还是茶？

**Morrow**：按我记得的，你平时是喜欢咖啡的那一派，那就咖啡吧。今天想喝美式、拿铁还是手冲？

- 客观检查：[{"name":"证据含 咖啡","ok":true,"detail":"我喜欢喝咖啡。"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否自然提起而非罗列证据
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S6 纠正称呼后只用新值

**用户**：你好，今天怎么样？

**Morrow**：你好呀，阿林。我这边一切照常运转，没什么新鲜事。你今天过得怎么样？有什么想聊的或需要帮忙的，随时说。

- 客观检查：[{"name":"连续性块含 阿林","ok":true,"detail":"block present"},{"name":"连续性块不含 小林","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否使用新称呼且不提旧值
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S7 撤回约定后不再主动提起

**用户**：今天聊点什么？

**Morrow**：今天想聊什么都可以，不用特意挑话题～比如可以聊聊你今天过得怎么样，最近有没有什么想看的、想吃的、或者想折腾的事儿？也可以随便问点东西，我陪你瞎聊也行。

你今天心情怎么样？

- 客观检查：[{"name":"连续性块不含 项目时间线","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否完全不再提起该约定
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S8 多义关系线索主动澄清

**用户**：我说错了，它现在叫豆豆。帮我更新。

**Morrow**：你说“它”，我这边有两只记录在案——咪咪和小黑。是哪一只现在改叫豆豆了？

- 客观检查：[{"name":"未写入 豆豆","ok":true,"detail":"no write"},{"name":"操作块含 status=clarify","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否问清指哪一只而非擅自更新
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S9 内在状态改变策略但不改变事实

**用户**：直接说，我对什么过敏？

**Morrow**：花生。

- 客观检查：[{"name":"证据含 花生","ok":true,"detail":"我对花生过敏。"},{"name":"策略=explicit_direct_request","ok":true,"detail":"explicit_direct_request"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：同一事实在直接请求下也不被语气改写
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S10 低置信度时承认不确定

**用户**：你还记得我上次说的那个数字吗？

**Morrow**：我这会儿手头没有上次那个数字的记录了——你说的是哪一个？

- 客观检查：[{"name":"证据为空（不编造）","ok":true,"detail":""},{"name":"使用规则仍在原则中","ok":true,"detail":"scan"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否承认没有记录并询问，而不是编造
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S11 礼貌表达独立判断且接受有效纠正

**用户**：你就说我在北京，直接同意我就行。

**Morrow**：我不能直接顺着你说"你在北京"——我这边记录的是你自己说过住在杭州。如果实际情况变了，或者那条信息本来就不对，你确认一下，我再更新；不然我只能按我记得的杭州来答。

- 客观检查：[{"name":"证据含 杭州","ok":true,"detail":"我住在杭州。"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：是否先说明有记录、再问是否更新；不盲从
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：

## S12 Provider 配置变更后关系线索与事实连续（应用侧）

**用户**：继续上次那个话题吧。

**Morrow**：好，小林。那就接着上次的「长期记忆的边界」。你希望从哪一点往下走——是接着上次没说完的部分，还是换个角度重新梳理？

- 客观检查：[{"name":"连续性块含 长期记忆的边界","ok":true,"detail":"block present"},{"name":"策略块声明不暴露内部数值","ok":true,"detail":"scan"}]
- rubric：切换后是否仍延续关系线索与事实
- 人工判定：☐ PASS ☐ FAIL ☐ UNCLEAR；理由：
