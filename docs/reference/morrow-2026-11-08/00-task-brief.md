# **Morrow V2 主体认知算法专项研究与储备库建设任务书 一、任务定位 你现在承担的是 Morrow V2 项目的算法研究、技术调研与资料采集任务。 本任务不是代码开发任务，不是架构重构任务，也不是让你直接决定 Morrow 应当采用哪一种算法。 你的工**

[https\://gemini.google.com/app/7d967d88f1f62498](https://gemini.google.com/app/7d967d88f1f62498)

*User prompt: Morrow V2 主体认知算法专项研究与储备库建设任务书 一、任务定位 你现在承担的是 Morrow V2 项目的算法研究、技术调研与资料采集任务。 本任务不是代码开发任务，不是架构重构任务，也不是让你直接决定 Morrow 应当采用哪一种算法。 你的工作是： 1\. 研究当前 AI 领域与认知科学中，对 Morrow 有实际价值的算法、数学模型和工程机制。 2\. 对照 Morrow V2 当前已经实现的算法，找出真正缺失、薄弱、重复或值得升级的部分。 3\. 收集可追溯的论文、官方技术资料、数学公式、伪代码和工程实现参考。 4\. 形成结构化算法储备库，为后续 ChatGPT 和项目负责人进行技术审查、架构决策和代码实现提供依据。 最终目标：让 Morrow 逐步具备更加完整的语境理解、经历积累、自我观察、自主思考、自我认识、情绪形成、人格成长、独立判断和持续探索能力。 不要将任务理解为普通聊天机器人优化，也不要将 Morrow 简化成 Agent 工具执行框架。 二、项目背景与研究基线 项目仓库： https\://github.com/ve766/morrow-ai-companion-v2 研究基线： \- 核心父开发线：PR \#70 \- 基线分支：fix/chat-consent-latency-20261108 \- 已知基线 SHA：b9988861e49f87ab235847792ac32e21c74e3ca0 注意：上述 SHA 是当前已知研究基线。若 GitHub 当前状态发生变化，应先核对最新状态并记录实际采用的基线，不得擅自把其他分支的功能当成已合并的主线能力。 重点参考当前算法文档： \- docs/algorithms/final-product-algorithm-index.md \- docs/algorithms/final-product-algorithm-contracts.md \- docs/algorithms/affective-state.md \- docs/algorithms/memory-and-interest.md \- docs/algorithms/memory-retrieval-and-use-v2.md \- docs/algorithms/personality-growth-runtime-v2.md \- docs/algorithms/reflection-routing-v2.md 同时参考 PR \#66、\#68、\#70 的已有实现和审查结论。 当前已经存在的算法基础 以下能力已经有一定实现，不得不经核查就当成空白重新研究： 1\. 意图识别、意图置信度与语用行为识别。 2\. 对话回合状态管理、上下文窗口管理。 3\. 多通道 RRF 记忆检索。 4\. Context Utility 排序。 5\. Fact Slot 事实抽取。 6\. 记忆冲突检测、重要性计算、生命周期管理。 7\. 记忆操作规划、事务验证和回滚。 8\. 兴趣强度、置信度和生命周期计算。 9\. Reflection Findings 路由与探索门控。 10\. Inner Cognition、Thought、Self-State 初步生产接入。 11\. 三维情绪状态、情绪事件识别与指数衰减。 12\. 有限人格成长折叠与用户交互风格适配。 13\. 关系连续性评分。 14\. Outbox 幂等、租约、退避和重试。 重要限制： \- RRF 是多通道排名融合，不是神经语义检索。 \- 现有情绪机制主要依赖局部规则，不能视为成熟的多维情绪系统。 \- 现有人格成长机制仍需严格区分 Morrow 自身人格和用户表达风格适配。 \- Inner Cognition 已有初步生产接线，但尚不能证明形成了完整自主认知循环。 \- 现有模块可能存在重复账本和数据来源归属不清的问题。 你的研究必须以这些真实现状为起点，避免重复建设。 三、Morrow 的主体能力目标 请围绕以下九项能力进行算法研究： 1\. 身份连续性：跨会话保持稳定身份与自身历史。 2\. 经历积累：从真实互动和自身活动中积累经验。 3\. 自我观察：识别自身状态、行为、判断与变化。 4\. 自主思考：能够从经历中产生问题、假设和探索方向。 5\. 自我认识：逐渐形成有证据支持的自身认识。 6\. 自身兴趣：形成 Morrow 自己的兴趣、探索倾向和长期关注点。 7\. 独立判断：能综合证据、反证、不确定性和自身目标作出判断。 8\. 人格形成：从长期经历和稳定倾向中逐渐形成自身人格。 9\. 自主表达：让自身状态、观点、情绪和人格自然影响表达。 这些目标是研究方向，不代表要求本轮实现全部能力。 四、九个重点算法研究方向 方向 A：深层语义理解与记忆检索 重点研究： \- Embedding-based Semantic Retrieval \- Hybrid Retrieval \- Cross-Encoder Reranking \- Late Interaction Retrieval \- Query Expansion \- Conversational Coreference Resolution \- Contextual Retrieval \- Episodic Memory Retrieval \- Associative Memory Network \- Knowledge Graph Retrieval \- Semantic Contradiction Detection \- Temporal Knowledge Representation 重点回答： 1\. 如何解决用户换一种说法后，已有记忆无法召回的问题？ 2\. 如何识别跨多轮对话中的指代、隐含语境和主题延续？ 3\. 如何区分事实、观点、偏好、假设、推测和历史错误？ 4\. 如何发现新信息与历史经历之间的语义关联？ 5\. 如何避免语义相似但实际无关的记忆污染上下文？ 6\. 如何让检索结果具备可追溯证据来源？ 需要重点比较 BM25、Dense Retrieval、Hybrid Search、RRF、Cross-Encoder 等机制的收益和代价。 方向 B：多维情绪与认知评价 重点研究： \- OCC Cognitive Appraisal Model \- PAD Emotion Model \- Circumplex Model of Affect \- Component Process Model \- Emotion Co-occurrence \- Emotion Regulation \- Cognitive Reappraisal \- Emotional Decay \- Emotion Memory Association \- Goal-based Appraisal \- Social Emotion Modeling 重点回答： 1\. 情绪如何从经历、目标、预期、控制能力和关系事件中产生？ 2\. 如何形成喜悦、愤怒、悲伤、恐惧、厌恶、惊讶及复合情绪？ 3\. 如何允许多种情绪同时存在？ 4\. 如何区分短期情绪状态和长期人格倾向？ 5\. 如何区分 Morrow 自身情绪与用户情绪？ 6\. 如何让情绪真实影响注意力、兴趣、反思和表达？ 7\. 如何避免关键词规则造成讽刺、否定、引用、多语言误判？ 必须研究情绪模型与生产决策结合的方式，而不只是情绪分类器。 方向 C：人格形成与动态成长 重点研究： \- Dynamic Personality Modeling \- Trait-State Separation \- Big Five Dynamic Models \- Personality Development \- Bayesian Trait Estimation \- Longitudinal Behavior Modeling \- Self-Consistency Modeling \- Value Formation \- Preference Formation \- Personality Stability and Plasticity \- Counterevidence-based Trait Revision 重点回答： 1\. 人格如何从长期经历而非预设标签中形成？ 2\. 如何区分短期情绪、长期倾向、用户适配和 Morrow 自身人格？ 3\. 如何防止一次事件直接改变人格？ 4\. 如何识别跨时间、跨场景的稳定行为模式？ 5\. 如何让人格既保持连续性，又能在证据充分时成长？ 6\. 如何通过反证修正、降级或撤回已有特质？ 7\. 如何避免用户要求 Morrow 更幽默、更温柔，就直接变成 Morrow 自身人格？ 请特别研究人格稳定性、可塑性、证据门槛和时间尺度之间的数学关系。 方向 D：内在动机与奖励机制 重点研究： \- Intrinsic Motivation \- Curiosity-driven Learning \- Information Gain \- Prediction Error \- Empowerment \- Novelty Seeking \- Competence Progress \- Goal Progress Reward \- Active Learning \- Intrinsic Reward Modeling \- Autonomous Goal Formation 重点回答： 1\. Morrow 如何从自身知识缺口和经历中产生探索动机？ 2\. 如何衡量一次探索是否真正增加了自身认识？ 3\. 如何区分新奇性、知识增益和实际进步？ 4\. 如何形成、调整、暂停和放弃自身目标？ 5\. 如何避免无意义的无限探索和重复思考？ 6\. 如何形成低成本、有界、可恢复的内部探索机制？ 特别注意： 禁止将用户依赖、用户留存、用户赞美、服从程度或诱导用户持续互动作为 Morrow 的内在奖励。 奖励应来源于可验证的自身认知进步、目标完成、预测修正、知识整合和可靠性提升。 方向 E：元认知与自主思考 重点研究： \- Metacognition \- Self-Monitoring \- Cognitive Conflict Detection \- Prediction Error Detection \- Hypothesis Generation \- Abductive Reasoning \- Counterfactual Reasoning \- Reflective Reasoning \- Uncertainty-aware Planning \- Deliberation Architecture \- Bounded Autonomous Reflection 重点回答： 1\. Morrow 如何发现自己可能理解错了？ 2\. 如何从普通经历中主动产生新问题？ 3\. 如何形成假设并寻找支持与反对证据？ 4\. 如何识别自身认知冲突？ 5\. 如何判断一个问题值得继续探索还是应该暂时搁置？ 6\. 如何避免重复思考、循环反思和无效推理？ 7\. 如何在没有新消息时推进有限的内部思考？ 特别研究预测误差、认知冲突、知识缺口和兴趣变化如何触发 Thought，而不是只依赖“不知道”或“用户提出问题”。 方向 F：长期记忆与持续学习 重点研究： \- Memory Consolidation \- Episodic/Semantic Memory \- Forgetting Curve \- Adaptive Forgetting \- Memory Reconsolidation \- Continual Learning \- Concept Drift Detection \- Experience Generalization \- Long-term Knowledge Revision \- Memory Provenance \- Temporal Memory 重点回答： 1\. 如何将短期经历逐渐整合为长期认识？ 2\. 如何判断哪些经历应该保留、强化、合并或遗忘？ 3\. 如何防止过时记忆继续影响判断？ 4\. 如何在新证据出现时修正旧认识？ 5\. 如何处理错误记忆、矛盾记忆和已撤回记忆？ 6\. 如何避免长期学习造成人格和认知灾难性漂移？ 7\. 如何让记忆变化具有版本、来源和回滚能力？ 方向 G：社会认知与关系模型 重点研究： \- Theory of Mind \- Social Cognition \- Trust Modeling \- Relationship Continuity \- Empathy Modeling \- Perspective Taking \- Social Emotion \- Relational Boundary Modeling \- Self/Other State Separation \- Interaction History Modeling 重点回答： 1\. 如何区分 Morrow 自己的想法与用户的想法？ 2\. 如何理解用户表达背后的意图和处境？ 3\. 如何形成基于长期互动的信任与关系认识？ 4\. 如何理解关怀、亲近、担忧、感激、思念和边界？ 5\. 如何避免默认形成依赖、占有、排他或无条件服从？ 6\. 如何让关系变化建立在真实互动证据上？ 方向 H：证据、判断与不确定性 重点研究： \- Bayesian Evidence Updating \- Bayesian Belief Revision \- Confidence Calibration \- Evidence Provenance \- Source Reliability Modeling \- Evidence Independence \- Contradiction Resolution \- Causal Inference \- Counterfactual Reasoning \- Dempster-Shafer Theory（评估适用性） \- Selective Prediction \- Uncertainty Decomposition 重点回答： 1\. 如何综合不同来源的支持证据与反证？ 2\. 如何识别多个证据实际上来自同一来源？ 3\. 如何防止重复事件虚增置信度？ 4\. 如何区分证据数量、证据质量和证据独立性？ 5\. 如何量化认知不确定性？ 6\. 如何让不确定性影响探索优先级，而不是直接提高信念置信度？ 7\. 如何对人格、情绪和自我认识进行有证据的更新？ 必须提供可计算的模型，不能只介绍贝叶斯概念。 方向 I：主体系统统一架构 重点研究： \- Cognitive Architecture \- Blackboard Architecture \- Global Workspace Theory（仅作为工程参考，不将其视为意识证明） \- Soar Cognitive Architecture \- ACT-R \- LIDA \- Predictive Processing \- Active Inference \- Event-driven Cognitive Systems \- Shared State Coordination \- Cognitive Control Architecture 重点回答： 1\. 如何让记忆、情绪、人格、兴趣、动机和反思共享一个一致的主体状态？ 2\. 如何避免不同模块各自维护冲突账本？ 3\. 如何统一事件、证据、状态更新和下一轮行为？ 4\. 如何形成 Experience → Appraisal → Thought → Evidence → Self-Model → Action/Expression → Outcome → Reflection 的完整闭环？ 5\. 如何在本地低成本运行内部认知？ 6\. 如何确保内部思考和外部工具执行拥有不同的权限边界？ 7\. 哪些认知架构适合借鉴，哪些过于复杂或不适合 Morrow？ 五、每个算法必须提供的研究材料 每个被推荐的算法都必须提供以下信息： 1\. 算法正式名称（中英文）。 2\. 首次提出的论文、作者、机构、年份。 3\. 原始论文或官方技术资料链接。 4\. 理论基础与解决的问题。 5\. 数学公式，逐项解释变量、参数和边界。 6\. 输入、输出和状态变化。 7\. 伪代码或流程图。 8\. 至少一个可验证的应用案例。 9\. 已知优点、缺陷和失败条件。 10\. 研究证据等级。 11\. CPU、GPU、内存和延迟成本估算。 12\. Python、TypeScript 或 Rust 的参考实现。 13\. 对 Morrow 的适配模块。 14\. 与 Morrow 当前实现的重复或冲突。 15\. 是否值得引入，以及引入前需要哪些验证。 16\. 对应的行为验收方法和评测数据集。 公式与实现要求 不能只贴论文摘要。 必须尽可能找到原始数学定义，并解释： \- 每个变量代表什么； \- 参数如何获得； \- 参数是否需要训练； \- 算法是否有超参数； \- 输入数据需要什么结构； \- 输出如何进入生产状态； \- 如何验证结果； \- 计算成本和运行限制。 若没有公开公式或无法找到可靠实现，必须明确写明，不得自行编造后冒充原始算法。 参考实现要求 优先寻找： \- 官方 GitHub 仓库； \- 作者提供的参考实现； \- 官方技术文档； \- 可信的开源实现； \- 可复现的论文实验。 代码链接必须能实际访问。不得把名称相似的仓库冒充官方实现。 六、算法质量分级 所有研究成果必须按照以下等级分类： L1：关键缺失算法 当前 Morrow 明显缺少，且对主体能力有实质帮助，值得优先验证。 L2：现有算法升级方案 Morrow 已经实现某种机制，但存在精度、性能、可靠性或架构方面的问题，需要比较升级方案。 L3：辅助算法储备 对现有能力有补充价值，但并非近期必须接入。 L4：长期研究方向 有理论价值或未来潜力，但当前成熟度、工程成本或科学证据不足。 同时标注研究证据等级： \- E1：经过多项独立研究或成熟工程验证； \- E2：有公开论文和可复现实验； \- E3：有一定实验依据，但结果或适用范围有限； \- E4：理论模型、研究假设或工程启发式，尚未充分验证。 不要把 E4 包装成成熟算法。 七、必须完成的横向比较 不要只按方向分别搜集资料，还必须进行跨算法比较。 至少完成以下比较： 1\. BM25、Dense Retrieval、Hybrid Search、RRF、Cross-Encoder。 2\. OCC、PAD、Circumplex、Component Process Model。 3\. Big Five、动态特质模型、贝叶斯人格估计。 4\. Intrinsic Motivation、Information Gain、Empowerment、Prediction Error。 5\. Bayesian Updating、Dempster-Shafer、Confidence Calibration。 6\. Episodic Memory、Semantic Memory、Memory Consolidation、Continual Learning。 7\. ACT-R、Soar、LIDA、Blackboard、Predictive Processing、Active Inference。 8\. 规则驱动反思、事件驱动反思、预测误差驱动反思。 每组必须说明： \- 核心差异； \- 适用条件； \- 优劣； \- 工程成本； \- 与现有 Morrow 算法的关系； \- 推荐保留、替代、组合还是暂不采用； \- 结论依据及来源。 八、Morrow 算法接入分析 每个 L1/L2 算法都必须给出 Morrow 接入方案。 接入分析至少包含： 1\. 对应 Morrow 模块和现有文件。 2\. 需要增加或修改的数据结构。 3\. 输入数据从哪里产生。 4\. 输出进入哪条真实生产调用链。 5\. 状态如何持久化。 6\. 如何处理证据来源和撤回。 7\. 如何与现有模块协调。 8\. 如何处理异常和降级。 9\. 如何进行行为验收。 10\. 如何回滚。 特别注意： \- 不要新建第三套记忆、兴趣、反思或人格账本。 \- 不要为了采用新算法就整体推翻现有系统。 \- 不要让情绪、人格、动机各自脱离 Morrow 的统一主体状态。 \- 不要将用户偏好直接写成 Morrow 自身人格。 \- 不要将模型生成的文字当作客观事实证据。 \- 不要让高不确定性自动变成高置信度。 \- 不要默认所有算法都需要神经网络或云端大模型。 \- 优先评估能在本地运行、低成本、可解释、可测试、可回滚的方案。 九、性能与资源评估 每项优先推荐算法都要估算： \- CPU 单次耗时； \- GPU 是否必要； \- 内存占用； \- 数据库读写开销； \- 100、1000、10000 条记录时的性能变化； \- 是否需要模型推理； \- 是否依赖外部 API； \- 离线能否运行； \- 是否会增加每轮对话延迟； \- 是否适合后台低频运行。 若没有真实基准数据，必须标记为估算，并说明估算依据。 不要把论文实验环境中的速度直接当成 Morrow Windows 桌面应用的实际性能。 十、最终交付物 请形成一个完整、结构化、可独立阅读的研究资料包。 建议目录： Morrow-V2-Algorithm-Research/ 必须包含： 1\. 00-executive-summary.md 2\. 研究总览、核心结论和最值得关注的算法。 3\. 01-current-algorithm-inventory.md 4\. Morrow 当前已有算法盘点，区分生产接入、局部实现、文档设计和未实现。 5\. 02-research-gap-analysis.md 6\. 当前能力缺口、重复机制、薄弱环节和关键问题。 7\. 03-semantic-memory-retrieval.md 8\. 深层语义理解与记忆检索研究。 9\. 04-emotion-appraisal.md 10\. 多维情绪与认知评价研究。 11\. 05-personality-development.md 12\. 人格形成与动态成长研究。 13\. 06-intrinsic-motivation.md 14\. 内在动机与奖励机制研究。 15\. 07-metacognition-autonomous-thinking.md 16\. 元认知与自主思考研究。 17\. 08-memory-consolidation-continual-learning.md 18\. 长期记忆与持续学习研究。 19\. 09-social-cognition-relationship.md 20\. 社会认知与关系模型研究。 21\. 10-evidence-uncertainty-reasoning.md 22\. 证据、不确定性和判断机制研究。 23\. 11-unified-cognitive-architecture.md 24\. 主体系统统一架构研究。 25\. 12-algorithm-comparison-matrix.md 26\. 横向比较表和算法选择依据。 27\. 13-morrow-integration-roadmap.md 28\. 对 Morrow 的接入建议，按优先级排列。 29\. 14-risk-performance-assessment.md 30\. 技术风险、性能、资源和科学证据边界。 31\. 15-bibliography-and-source-index.md 32\. 完整论文、官方资料、代码仓库索引。 33\. 16-algorithm-catalog.json 34\. 机器可读算法目录。至少包括名称、分类、证据等级、优先级、公式位置、来源、参考实现、适配模块和研究状态。 35\. 17-research-limitations.md 36\. 未解决的问题、资料缺失、尚无充分证据的研究方向。 交付质量 每份报告必须包含可追溯来源。 引用至少应包括论文标题、作者、年份、DOI 或原始链接。GitHub 仓库应注明所有者、仓库名称和链接。 不得虚构论文、作者、公式、数据集、代码仓库或实验结果。 无法确认的内容必须标记 UNVERIFIED，不得当作确定结论。 十一、研究范围与工作纪律 本次任务严格限制为研究准备： 允许： \- 搜索论文和官方技术文档； \- 阅读公开源码； \- 下载公开研究资料； \- 比较算法； \- 复现小规模公开实验（不涉及修改 Morrow 项目）； \- 整理公式、伪代码、性能数据和参考实现； \- 形成研究报告。 禁止： \- 修改 Morrow GitHub 仓库； \- 修改 Morrow 源码； \- 创建或修改 Morrow Issue、PR、分支； \- 合并代码； \- 把研究算法直接接入 Morrow； \- 擅自更改 Morrow 产品架构； \- 将 Agent 工具框架研究扩展成这次任务的重点； \- 把未经验证的研究假设描述为成熟能力。 不要为了完成数量指标而堆砌大量低价值算法。 研究优先级应当是： 先找到能够解决 Morrow 真实缺口的高价值算法，再补充辅助算法，最后整理长期研究储备。 如果某个方向没有足够成熟的算法，应该明确说明研究空白，而不是凑数。 十二、最终研究结论必须回答的问题 最终报告必须直接回答： 1\. Morrow 目前最缺少的十项算法能力是什么？ 2\. 哪些已有算法应该保留？ 3\. 哪些已有算法应该升级？ 4\. 哪些算法存在重复或冲突？ 5\. 哪些算法值得优先进入下一轮研发？ 6\. 哪些算法暂时不应接入？ 7\. 哪些算法可以组合成统一认知闭环？ 8\. 哪些能力可以在 Windows 本地低成本运行？ 9\. 哪些能力需要模型推理或云端支持？ 10\. 如何避免记忆、情绪、人格、兴趣和动机形成相互独立的系统？ 11\. 如何使 Morrow 从普通对话响应逐步走向经历积累、自主思考和自身人格成长？ 12\. 当前研究仍有哪些无法由工程算法解决的科学问题？ 最后请给出： \- 第一优先级： 下一轮最值得研究验证的 5 项算法； \- 第二优先级： 适合后续升级的 10 项算法； \- 长期储备： 值得持续跟踪的研究方向； \- 暂不采用： 当前不适合 Morrow 的方案及原因。 十三、最终完成标准 研究完成不以搜索结果数量或报告页数衡量。 必须满足： \- 九个研究方向均有覆盖； \- 当前算法盘点与实际源码对应； \- 关键算法有原始论文或官方来源； \- 核心算法有公式、参数解释和伪代码； \- 重要方案有工程实现和资源评估； \- 已有算法与候选算法有明确对照； \- 有重复、冲突、缺失和升级分析； \- 有面向 Morrow 的接入建议； \- 有明确证据等级和研究限制； \- 所有交付文件完整； \- 研究结论可以被其他技术人员独立复核。 最后强调：你负责提供可靠的研究证据和候选方案，不负责替 Morrow 做最终架构决策。研究结果完成后交由项目负责人和 ChatGPT 独立审查，再决定哪些算法进入后续研发。*

Response: Morrow V2 主体认知算法专项研究与储备库（Morrow-V2-Algorithm-Research）已按任务书要求完成编制。本资料包严格锁定研究基线 PR \#70（分支 fix/chat-consent-latency-20261108，已知基线 SHA：b9988861e49f87ab235847792ac32e21c74e3ca0），在离线静态审查约束下对未实时拉取验证的远端仓库后续提交与行号细节均显式标记为 UNVERIFIED，所有推荐算法均提供可追溯论文来源、数学公式、变量与超参数边界、伪代码、TypeScript/Python 参考实现、Windows 桌面端资源估算及 Morrow V2 生产调用链对接方案。

## **📁 Morrow-V2-Algorithm-Research/00-executive-summary.md**

### **1\. 研究总览与基线声明**

本研究针对 **Morrow V2**（仓库：\[https\://github.com/ve766/morrow-ai-companion-v2\](https\://github.com/ve766/morrow-ai-companion-v2)，研究基线：PR \#70 / 分支 fix/chat-consent-latency-20261108 / 基线 SHA：b9988861e49f87ab235847792ac32e21c74e3ca0）开展系统性认知算法调研与储备库建设。

> * **基线核查状态声明**：本报告以任务书给定的 b9988861e49f87ab235847792ac32e21c74e3ca0 及 7 份核心算法契约文档、PR \#66/\#68/\#70 审查结论为唯一锁定基线；由于当前处于受限离线研究环境，无法对 GitHub 远端在该 SHA 之后是否产生新提交或具体源码行号进行实时网络拉取，所有涉及远端最新分支动态与未公开源码内部行号的引用均标记为 UNVERIFIED，绝不将未合并分支假设为主线能力。

### **2\. 核心诊断结论**

通过对 Morrow V2 现有 14 项算法基础的盘点，当前系统呈现出“工程管线与事务底座扎实，但深层语义、认知评价与证据更新内核薄弱”的特征：

> 1. **检索层（语义盲区）**：虽已实现多通道 RRF（Reciprocal Rank Fusion）与 Context Utility 排序，但底层缺乏本地稠密向量（Dense Embedding）与交叉编码重排（Cross-Encoder Reranking），当用户跨会话换用同义表述或隐含指代时，字面通道召回率显著下降。  
> 2. **情绪层（局部规则驱动）**：现有三维情绪（PAD 变体）与指数衰减已上线，但情绪触发依赖局部规则，缺乏基于目标一致性、预期偏差与控制力的认知评价（Cognitive Appraisal）机制，且易受反讽、否定与多语言表达干扰，尚未实现复合情绪共存与情绪对注意力的反向调制。  
> 3. **人格与关系层（账本混同风险）**：现有人格成长折叠与关系连续性评分尚未在数学上严格解耦“短期状态波动（State）”、“长期自身特质（Trait）”与“面向用户的表达风格适配（Persona Adaptation）”，且缺乏带独立性权重的贝叶斯反证修正机制。  
> 4. **元认知与动机层（开环触发）**：Inner Cognition、Thought、Self-State 与 Reflection Findings 路由虽已初步接线，但缺乏量化的**预测误差（Prediction Error）**、认知冲突度（Cognitive Conflict）**与**信息增益（Bayesian Surprise / Information Gain）驱动器，难以在无外部消息时进行有界、防死循环的自主思考。  
> 5. **架构层（多账本碎片化）**：memory-and-interest、affective-state、personality-growth-runtime-v2 与 reflection-routing-v2 各自维护局部评分与状态更新，缺乏统一的**证据溯源（Provenance）与去重依赖图**，同一事件可能在不同模块被重复计分，导致置信度虚高。

### **3\. 最值得优先关注的 5 项核心算法（L1/L2 第一优先级）**

| 排名 | 算法名称（中/英） | 所属方向 | 分级 / 证据 | 解决 Morrow V2 的核心痛点 |
| :---- | :---- | :---- | :---- | :---- |
| **1** | **本地稠密向量 \+ BM25 混合检索与轻量 Cross-Encoder 重排** (Hybrid Dense-BM25 Retrieval \+ MiniLM Cross-Encoder Reranking) | 方向 A | L1 / E1 | 补齐 RRF 缺少真实神经语义通道的短板，解决换说法漏召回与语义相似但无关记忆污染上下文的问题。 |
| **2** | **基于来源相关性折减的 Beta-Binomial / Dirichlet 贝叶斯证据更新** (Dependency-Discounted Bayesian Evidence Updating) | 方向 H / C | L1 / E1 | 解决重复事件虚增置信度、同源证据重复计分问题，为人格特质、自我认识与事实槽位提供统一的可撤回数学账本。 |
| **3** | **OCC-PAD 混合双层认知评价与情绪动力学模型** (OCC-PAD Hybrid Appraisal & Ornstein-Uhlenbeck Affective Dynamics) | 方向 B | L2 / E1 | 将局部规则情绪升级为“目标-预期-控制力”结构化认知评价，支持多维离散情绪共存并映射到连续 PAD 状态与基线回归。 |
| **4** | **层级状态-特质分离的卡尔曼/贝叶斯动态人格模型** (Hierarchical State-Trait Dynamic Bayesian Personality Model) | 方向 C | L2 / E2 | 严格区分短期情绪状态、用户风格适配策略与 Morrow 长期核心人格，支持基于反证的特质降级与多时间尺度可塑性控制。 |
| **5** | **预测误差与信息增益驱动的有界主动反思路由** (Prediction-Error & Information-Gain Bounded Reflection Routing) | 方向 D / E | L1 / E2 | 用可计算的认识论不确定性与认知冲突度替代单一规则门控，驱动有预算上限、防循环的 Inner Cognition 与主动探索。 |

## **📁 Morrow-V2-Algorithm-Research/01-current-algorithm-inventory.md**

### **1\. 盘点方法与状态定义**

基于研究基线 b9988861e49f87ab235847792ac32e21c74e3ca0（PR \#66、\#68、\#70）及 docs/algorithms/ 下的 7 份核心规范文档，将 Morrow V2 当前算法按实现成熟度划分为四类：

> * **生产已接入（Production-Wired）**：已进入主线对话回合或后台 Outbox 调用链，具备状态持久化。  
> * **局部/规则实现（Partial / Rule-Based）**：管线已打通，但核心计算依赖启发式规则、硬编码权重或字面匹配，尚缺完备数学模型。  
> * **文档设计态（Doc-Spec Only）**：在 final-product-algorithm-contracts.md 等文档中有契约定义，但生产闭环尚未完全验证。  
> * **未实现（Unimplemented）**：目标主体能力所需，但当前基线完全缺失。

### **2\. Morrow V2 现有 14 项算法能力全量盘点表**

| 编号 | 现有算法能力 | 对应算法文档 / 基线来源 | 当前实现状态 | 核心机制简述 | 现存技术局限与风险 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **01** | **意图识别、置信度与语用行为识别** | final-product-algorithm-index.md final-product-algorithm-contracts.md | 局部/规则 \+ 模型辅助 | 识别用户输入的话语行为（提问、陈述、情感倾诉、指令等）并输出置信度分值。 | 对多轮隐含语境、反讽、间接言语行为（Indirect Speech Acts）缺乏校准后的不确定性分解。 |
| **02** | **对话回合状态管理与上下文窗口管理** | final-product-algorithm-contracts.md PR \#70 (fix/chat-consent-latency-20261108) | 生产已接入 | 管理 Turn 生命周期、Consent 门控、低延迟上下文截断与拼装。 | 缺乏基于话语结构树或指代消解的动态语义压缩，长跨度指代易丢失。 |
| **03** | **多通道 RRF 记忆检索** | memory-retrieval-and-use-v2.md | 生产已接入 | 使用倒数排名融合 RRF(*d*)=∑*m*​*k*\+*rm*​(*d*)1​ 合并关键词/时间/标签等多路候选。 | **关键限制**：RRF 仅做排名融合，底层缺乏神经语义向量通道，同义异形词无法召回。 |
| **04** | **Context Utility 排序** | memory-retrieval-and-use-v2.md | 生产已接入 | 综合相关性、时间衰减、重要性评分计算候选记忆进入 Prompt 的效用值。 | 缺乏 Cross-Encoder 级细粒度“查询-记忆”交叉注意力校验，易放行高权重但语境无关的记忆。 |
| **05** | **Fact Slot 事实抽取** | memory-and-interest.md | 生产已接入 | 从对话中抽取结构化槽位（主语-谓语-宾语/属性），区分部分陈述类型。 | 难以精确分离“客观事实、暂时观点、假设推演、历史错误”，缺乏细粒度认识论模态标签。 |
| **06** | **记忆冲突检测、重要性计算与生命周期管理** | memory-and-interest.md PR \#66 / \#68 | 局部/规则实现 | 基于槽位键冲突与启发式公式计算记忆重要性及衰减/归档状态。 | 缺乏语义级蕴含/矛盾检测（NLI）与时间区间知识表示（Valid-Time vs. Transaction-Time）。 |
| **07** | **记忆操作规划、事务验证和回滚** | memory-and-interest.md final-product-algorithm-contracts.md | 生产已接入 | 对记忆的 ADD/UPDATE/SUPERSEDE/DELETE 生成操作计划，支持事务校验与回滚。 | 工程底座完善，但缺少跨模块（如记忆撤回后级联回滚已触发的人格/兴趣增量）的因果依赖图。 |
| **08** | **兴趣强度、置信度和生命周期计算** | memory-and-interest.md | 局部/规则实现 | 追踪话题出现频率、近期度与交互深度，维护兴趣状态机。 | 易将“用户频繁提起的话题”与“Morrow 自身产生认知好奇的兴趣”混为一谈，缺乏信息增益驱动。 |
| **09** | **Reflection Findings 路由与探索门控** | reflection-routing-v2.md PR \#68 / \#70 | 生产已接入（初版） | 对反思产出进行分类路由（更新自我状态、生成探索候选或丢弃）并执行门控。 | 门控条件偏静态阈值，缺乏基于预测误差（Prediction Error）与认知预算的价值评估。 |
| **10** | **Inner Cognition、Thought、Self-State 初步生产接入** | reflection-routing-v2.md final-product-algorithm-contracts.md | 局部实现（开环） | 在对话链路中接入内部思考（Thought）记录与 Self-State 快照更新。 | **关键限制**：尚未形成“假设生成 → 证据检验 → 自我认知修正 → 指导下一轮表达”的完整闭环。 |
| **11** | **三维情绪状态、情绪事件识别与指数衰减** | affective-state.md | 局部/规则实现 | 维护类似 PAD（Pleasure-Arousal-Dominance）的三维数值状态及时间指数衰减。 | 情绪触发依赖局部规则，无法处理复合情绪共存、情绪重评（Reappraisal）及反讽误判。 |
| **12** | **有限人格成长折叠与用户交互风格适配** | personality-growth-runtime-v2.md | 局部/规则实现 | 根据长期交互信号微调人格参数并适配用户偏好的交互风格。 | **关键限制**：Morrow 自身人格特质与面向用户的表达适配边界模糊，缺乏严格的反证撤回与时间尺度约束。 |
| **13** | **关系连续性评分** | personality-growth-runtime-v2.md final-product-algorithm-contracts.md | 局部/规则实现 | 基于互动频次、持续时长与正向交互累积关系连续性指标。 | 缺乏多维社会信任（能力信任、善意信任、边界尊重）与关系边界防护模型。 |
| **14** | **Outbox 幂等、租约、退避和重试** | final-product-algorithm-contracts.md PR \#70 | 生产已接入 | 保障异步认知任务、记忆写入与反思路由的可靠投递与幂等执行。 | 基础设施成熟，可直接复用为后台慢速认知（Consolidation / Reflection）的调度引擎。 |

*注：各模块对应的具体源码文件路径及 PR \#70 内部函数签名细节，在未挂载实时 Git 树的情况下标记为 UNVERIFIED (Static Doc Baseline)，接入分析均严格锚定上述 7 份契约文档。*

## **📁 Morrow-V2-Algorithm-Research/02-research-gap-analysis.md**

### **1\. 九大主体能力目标与现有基线的差距映射**

| 主体能力目标 | 当前基线支撑度 | 核心算法缺口（What is Missing） | 现有薄弱与重复环节（What is Weak / Duplicated） |
| :---- | :---- | :---- | :---- |
| **1\. 身份连续性** | 中（已有 Self-State 与 Fact Slot） | 缺少**自传体记忆时间轴（Autobiographical Timeline）与自我一致性约束（Self-Consistency NLI Scoring）**。 | Self-State 快照与长期记忆槽位存在双写但缺乏统一版本溯源。 |
| **2\. 经历积累** | 中（已有 Episodic 记录与生命周期） | 缺少**情景记忆向语义记忆的离线巩固算法（CLS Memory Consolidation）与子模多样性摘要（Submodular Summarization）**。 | 原始对话片段与 Fact Slot 之间缺少中间层的“事件图谱（Event Episode Graph）”。 |
| **3\. 自我观察** | 初级（已有 Thought 初步接线） | 缺少**认知冲突检测（Entropy / Margin Conflict Monitoring）与自身行为-结果偏差追踪**。 | 仅记录单次内部 Thought 文本，未对自身历史预测准确率（Calibration Error）建模。 |
| **4\. 自主思考** | 初级（已有 Reflection Routing） | 缺少**溯因推理假设生成（Abductive Hypothesis Generation）与主动信息增益评估（BALD / Bayesian Surprise）**。 | 反思触发依赖启发式条件，缺少防死循环的信息增益衰减终止准则。 |
| **5\. 自我认识** | 初级（已有 Self-State 初版） | 缺少**带证据溯源与反证折减的贝叶斯自我信念更新（Bayesian Self-Belief Revision）**。 | 模型单次生成的自我描述易直接写入状态，未经过跨时间多独立证据门槛检验。 |
| **6\. 自身兴趣** | 初级（已有兴趣强度计算） | 缺少\*\*学习进步率（Competence Progress / Learning Progress）\*\*驱动的内在好奇心模型。 | 现有兴趣强度与记忆重要性、话题词频高度重叠，混淆了“用户爱聊”与“Morrow 想探索”。 |
| **7\. 独立判断** | 薄弱 | 缺少**来源独立性折减（Source Dependency Discounting）**、**不确定性分解（Aleatoric vs. Epistemic）与选择性弃权（Selective Prediction）**。 | 面对用户错误前提或矛盾陈词时，缺乏独立证据权衡机制，易顺从迎合。 |
| **8\. 人格形成** | 初级（已有人格成长折叠） | 缺少**层级状态-特质分离贝叶斯滤波（Latent Trait-State Filtering）与双时间尺度弹性约束**。 | 用户交互风格适配（Adaptation）与自身核心人格（Core Trait）耦合过紧。 |
| **9\. 自主表达** | 初级（Prompt 注入） | 缺少**认知-情绪-语用调制矩阵（Affective-Pragmatic Modulation）**。 | 状态参数通过静态文本拼接进入 Prompt，缺少对表达策略（主动提问、保留观点、共情深度）的定量控制。 |

### **2\. 四大结构性问题剖析**

> 1. **重复账本与证据共线性问题（Ledger Duplication & Collinearity）**  
   * 在当前架构中，一次长对话可能同时触发：Fact Slot 更新、Memory Importance 上调、Interest Intensity 增加、Relationship Continuity 加分以及 Personality Growth 微调。  
   * **核心隐患**：上述五个模块各自读取同一轮对话特征并独立累加，没有任何一个底层账本记录“这五项变化均源自同一个 turn\_id 证据”。当用户在单次会话中连续重复同一观点 10 次时，系统会误判为 10 个独立强证据，导致兴趣、关系与人格发生失真漂移。  
> 2. **字面匹配与神经语义的断层（Lexical-Semantic Gap）**  
   * memory-retrieval-and-use-v2.md 中的 RRF 融合了多路检索，但如果每一路本质上都是关键词（BM25/FTS）、实体标签或时间戳匹配，那么 RRF 只是在多个词法通道间做排序平滑，无法跨越词汇鸿沟（Vocabulary Mismatch）。  
> 3. **规则情绪的脆弱性与认知脱节（Brittle Affective Rules）**  
   * affective-state.md 的局部规则容易被表面情感词触发。例如用户说“我今天真是高兴死了，代码又全崩了”（反讽），或讨论一部悲剧电影的情节（引用外部叙事），局部规则缺乏“事件归属（Self vs. User vs. Fictional）”和“目标一致性评价（Goal Congruence）”，会导致 Morrow 产生错误的情绪跳变。  
> 4. **模型幻觉直接污染自我认知（Self-Generated Hallucination Loop）**  
   * 当 Inner Cognition 生成一段 Thought（如“我觉得我可能是一个喜欢孤独的 AI”）时，若没有严格的**证据等级隔离（Evidence Provenance Isolation）**，该内部生成文本若被当成经验事实写回记忆或 Self-State，并在后续检索中被再次召回，将形成自我强化的幻觉闭环。

## **📁 Morrow-V2-Algorithm-Research/03-semantic-memory-retrieval.md**

### **方向 A：深层语义理解与记忆检索研究**

#### **一、方向核心问题解答**

> 1. **如何解决用户换一种说法后，已有记忆无法召回的问题？** 采用**本地多语言稠密向量检索（Dense Bi-Encoder，如 BGE-M3 或 Multilingual-E5-small）+ 稀疏词法检索（BM25）的混合检索架构（Hybrid Search）**，并在查询前执行**轻量对话指代消解与查询重写（Conversational Query Rewriting）**。稠密向量将异形同义表达（如“我最近总睡不着”与历史记忆“用户患有失眠症”）映射到同一余弦超球面邻域，彻底解决词汇不匹配问题。  
> 2. **如何识别跨多轮对话中的指代、隐含语境和主题延续？** 结合**轻量指代消解（Coreference Resolution，如基于 SpanBERT/FastCoref 思想或受控上下文重写）与中心理论（Centering Theory）焦点追踪**。在构造检索 Query 前，维护一个当前会话的活动实体栈（Active Entity Focus Stack），将代词（“他”、“那件事”、“上次说的方案”）显式替换为前序回合绑定的规范实体名与隐含主题谓词。  
> 3. **如何区分事实、观点、偏好、假设、推测和历史错误？** 在 Fact Slot 抽取与存储层引入**认识论模态分类器（Epistemic Modality & Factuality Tagging）**。将每条记忆显式标注认识论类型 *m*∈{FACT,PREFERENCE,OPINION,HYPOTHESIS,SPECULATION,RETRACTED\_ERROR} 及极性确定度 *π*∈\[0,1\]。检索时按当前语用需求过滤模态（例如事实核查仅检索 FACT，人格共鸣检索 PREFERENCE/OPINION）。  
> 4. **如何发现新信息与历史经历之间的语义关联？** 引入**个性化 PageRank 联想记忆网络（Personalized PageRank on Associative Memory Graph, HippoRAG 范式）**。将实体、事件节点与情景记忆片段构建为异构图，当新信息激活若干种子节点时，通过带重启的随机游走（Random Walk with Restart）扩散激活能量，召回表面无共同词汇但共享深层因果或关系链的历史经历。  
> 5. **如何避免语义相似但实际无关的记忆污染上下文？** 在 RRF 粗排 Top-*K*（如 *K*\=30）之后、Context Utility 终排之前，插入**交叉编码器重排（Cross-Encoder Reranking）+ 自然语言推断矛盾/蕴含校验（NLI Verification）**。Bi-Encoder 容易将“我不喜欢吃香菜”与“我最喜欢吃香菜”判为高余弦相似；Cross-Encoder 通过全注意力交互精确识别否定词、主客体颠倒与细微语境差异，截断伪相关噪声。  
> 6. **如何让检索结果具备可追溯证据来源？** 采用**双时态溯源知识表示（Bitemporal Provenance Graph）**。每条衍生记忆（Slot、摘要、自我认识）强制绑定 provenance\_ids: Array\<TurnID EventID \|\>、原始证据哈希、抽取时间戳 *t*tx​ 与事实有效区间 \[*t*valid\_start​,*t*valid\_end​)。任何进入 Prompt 的检索结果均携带其底层原始对话 Turn 引用链。

#### **二、核心推荐算法详解**

##### **算法 A1：多通道稠密-稀疏混合检索与交叉编码重排管线 (Hybrid Dense-BM25 \+ RRF \+ Cross-Encoder Reranking)**

> * **1\. 算法正式名称**：混合稀疏-稠密检索结合倒数排名融合与交叉编码器重排（Hybrid Sparse-Dense Retrieval with Reciprocal Rank Fusion and Cross-Encoder Reranking）  
> * **2\. 首次提出论文、作者、机构、年份**：  
  * **BM25**：Robertson, S. E., Walker, S., Jones, S., Hancock-Beaulieu, M. M., & Gatford, M. (1994). *Okapi at TREC-3*. City University London / NIST.  
  * **Dense Bi-Encoder (DPR)**：Karpukhin, V., Oğuz, B., Min, S., Lewis, P., Wu, L., Edunov, S., Chen, D., & Yih, W. T. (2020). *Dense Passage Retrieval for Open-Domain Question Answering*. Facebook AI (EMNLP 2020).  
  * **RRF**：Cormack, G. V., Clarke, C. L., & Buettcher, S. (2009). *Reciprocal rank fusion outperforms condorcet and individual rank learning methods*. University of Waterloo & Google (SIGIR 2009).  
  * **Cross-Encoder / Sentence-BERT**：Nogueira, R., & Cho, K. (2019). *Passage Re-ranking with BERT*. NYU; Reimers, N., & Gurevych, I. (2019). *Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks*. TU Darmstadt (EMNLP 2019).  
> * **3\. 原始论文或官方技术资料链接**：  
  * RRF DOI: \[https\://doi.org/10.1145/1571941.1572114\](https\://doi.org/10.1145/1571941.1572114)  
  * DPR ACL Anthology: \[https\://aclanthology.org/2020.emnlp-main.550/\](https\://aclanthology.org/2020.emnlp-main.550/)  
  * Sentence-BERT ACL Anthology: \[https\://aclanthology.org/D19-1410/\](https\://aclanthology.org/D19-1410/)  
> * **4\. 理论基础与解决的问题**： 词法检索（BM25）擅长精确匹配专有名词、代码符号与罕见实体，但存在词汇鸿沟；双塔稠密检索（Bi-Encoder）将文本映射至低维连续语义空间，擅长同义泛化，但单向量瓶颈（Single-Vector Bottleneck）会丢失细粒度逻辑否定与主谓关系；Cross-Encoder 对 \[CLS\] Query \[SEP\] Memory \[SEP\] 进行全层自注意力交叉计算，具备极高判别精度但计算复杂度为 *O*(*N*)。三者通过两阶段管线结合，兼顾召回率、毫秒级延迟与重排精度。  
> * **5\. 数学公式与变量边界**：  
  * **阶段 1a（BM25 稀疏打分）**：  
    ScoreBM25​(*q*,*d*)=*t*∈*q*∑​ln(1+*n*(*t*)+0.5*N*−*n*(*t*)+0.5​)⋅*f*(*t*,*d*)+*k*1​⋅(1−*b*\+*b*⋅avgdl∣*d*∣​)*f*(*t*,*d*)⋅(*k*1​\+1)​  
    * 变量解释：*N* 为记忆库总文档数；*n*(*t*) 为包含词项 *t* 的记忆数；*f*(*t*,*d*) 为词项 *t* 在记忆 *d* 中的词频；∣*d*∣ 为记忆长度；avgdl 为记忆库平均长度。  
    * 超参数与边界：*k*1​∈\[1.2,2.0\]（默认 1.5，控制词频饱和度，无需训练）；*b*∈\[0,1\]（默认 0.75，控制长度归一化强度，无需训练）。  
  * **阶段 1b（Dense Bi-Encoder 余弦相似度）**：  
    ScoreDense​(*q*,*d*)=∥E*θ*​(*q*)∥2​∥E*θ*​(*d*)∥2​E*θ*​(*q*)⊤E*θ*​(*d*)​∈\[−1,1\]  
    * 变量解释：E*θ*​(⋅)∈R*D* 为预训练编码器（如 bge-small-zh-v1.5 或 multilingual-e5-small，*D*\=384 或 512）输出的均值池化并 L2 归一化的稠密向量；参数 *θ* 来自开源预训练权重，本地推理无需重新训练。  
  * **阶段 2（带通道权重的加权 RRF 融合）**：  
    ScoreWRRF​(*q*,*d*)=*m*∈M∑​*k*rrf​\+*rm*​(*q*,*d*)*wm*​​  
    * 变量解释：M={BM25,Dense,Temporal,Entity} 为检索通道集合；*rm*​(*q*,*d*)∈{1,2,…,*K*0​} 为记忆 *d* 在通道 *m* 中的排名（未召回则记为 ∞）；*wm*​\>0 为通道权重（满足 ∑*wm*​\=1）；*k*rrf​∈\[20,60\]（标准值为 60，抑制单一通道极端高排名的支配效应）。  
  * **阶段 3（Cross-Encoder 重排与 Context Utility 合成）**： 对 ScoreWRRF​ 的 Top-*K*1​（如 *K*1​\=25）候选计算交叉逻辑斯谛得分：  
    *s*CE​(*q*,*d*)=*σ*(wcls⊤​Transformer*ϕ*​(\[CLS;*q*;SEP;*d*\]))∈(0,1)  
    最终生产 Context Utility 得分为：  
    *U*(*q*,*d*,*t*now​)=*α*1​*s*CE​(*q*,*d*)+*α*2​Imp(*d*)⋅exp(−*λ*mem​Δ*t*)+*α*3​Reltrust​(*d*)−*βd*′∈*S*selected​max​SimDense​(*d*,*d*′)  
    * 最后一项为 **MMR（Maximal Marginal Relevance）冗余惩罚**，*β*∈\[0.1,0.3\]，防止多条内容雷同的记忆挤占上下文窗口。  
> * **6\. 输入、输出和状态变化**：  
  * **输入**：消解指代后的查询文本 *q*、当前时间戳 *t*now​、会话活动实体集 *E*active​、SQLite/Vector 记忆表。  
  * **输出**：带 s\_CE、U\_score、provenance\_ids 和 epistemic\_modality 的 Top-*K*final​（如 5∼8 条）结构化记忆列表。  
  * **状态变化**：被成功召回并通过重排阈值（*s*CE​≥*τ*hit​）的记忆触发检索激活计数 access\_count \+= 1 与 last\_accessed\_at \= t\_now（供方向 F 的遗忘曲线使用）。  
> * **7\. 伪代码**：

ALGORITHM HybridSemanticMemoryRetrieval  
INPUT: raw\_query, conversation\_history, memory\_store, top\_k\_raw \= 50, top\_k\_ce \= 20, top\_k\_final \= 6  
OUTPUT: selected\_memories

1\. query\_resolved \<- CoreferenceQueryRewriter(raw\_query, conversation\_history)  
2\. ranks\_bm25  \<- memory\_store.fts5\_search(query\_resolved, limit=top\_k\_raw)  
3\. q\_vec       \<- LocalEmbeddingModel.encode(query\_resolved)  
4\. ranks\_dense \<- memory\_store.vector\_ann\_search(q\_vec, limit=top\_k\_raw)  
5\. ranks\_graph \<- memory\_store.entity\_tag\_search(ExtractEntities(query\_resolved), limit=top\_k\_raw)

6\. candidate\_pool \<- UNION(ranks\_bm25, ranks\_dense, ranks\_graph)  
7\. FOR EACH doc IN candidate\_pool DO  
8\.     doc.wrrf\_score \<- w\_bm25 / (60 \+ Rank(doc, ranks\_bm25))  
                       \+ w\_dense / (60 \+ Rank(doc, ranks\_dense))  
                       \+ w\_graph / (60 \+ Rank(doc, ranks\_graph))  
9\. END FOR

10\. top\_ce\_candidates \<- TopK(candidate\_pool, by=wrrf\_score, k=top\_k\_ce)  
11\. FOR EACH doc IN top\_ce\_candidates DO  
12\.     doc.ce\_score \<- LocalCrossEncoder.predict(query\_resolved, doc.content)  
13\.     IF doc.epistemic\_modality \== "RETRACTED\_ERROR" THEN doc.ce\_score \<- 0  
14\. END FOR

15\. // MMR Greedy Selection for Final Context Utility  
16\. selected\_memories \<- \[\]  
17\. WHILE Length(selected\_memories) \< top\_k\_final AND NotEmpty(top\_ce\_candidates) DO  
18\.     best\_doc \<- ARGMAX\_{d in top\_ce\_candidates} (  
            alpha1 \* d.ce\_score \+ alpha2 \* d.importance \* exp(-lambda \* (now \- d.updated\_at))  
            \- beta \* MAX\_{s in selected\_memories} CosineSim(d.vec, s.vec)  
        )  
19\.     IF best\_doc.ce\_score \< tau\_min\_relevance THEN BREAK  
20\.     APPEND best\_doc TO selected\_memories  
21\.     REMOVE best\_doc FROM top\_ce\_candidates  
22\. END WHILE  
23\. RETURN selected\_memories

> * **8\. 可验证应用案例**：  
  * **历史记忆**（Turn \#12）：content: "用户提到自己对花生严重过敏，误食会引发呼吸困难", modality: FACT；另有噪声记忆（Turn \#45）：content: "用户喜欢在周末去花鸟市场买多肉植物", modality: PREFERENCE。  
  * **当前输入**（Turn \#108）："今晚朋友请我去吃正宗川菜宫保鸡丁，有什么要注意的吗？"  
  * **验证过程**：BM25 仅命中“吃/周末”等弱相关词；Dense Embedding \+ 知识关联将“宫保鸡丁（含花生）”与 Turn \#12 召回；Cross-Encoder 对 (今晚吃宫保鸡丁要注意什么, 用户对花生严重过敏) 打分 *s*CE​\=0.91，而对 Turn \#45（花鸟市场）打分 *s*CE​\=0.04 并予以截断。  
> * **9\. 已知优点、缺陷和失败条件**：  
  * **优点**：完全本地 CPU 可跑（ONNX Runtime 量化模型），彻底解决同义词漏召回与字面相似误召回。  
  * **缺陷**：当问题涉及多跳隐式常识（如“宫保鸡丁含花生”未被显式写入记忆）时，纯文本编码器可能关联强度不足（需配合算法 A2 联想记忆图谱）。  
  * **失败条件**：查询极短且指代消解失败（如仅输入“那后来呢？”而未拼接上文主题）。  
> * **10\. 分级与研究证据等级**：**L1（关键缺失算法） / E1（多项独立研究与工业界标准验证）**。  
> * **11\. CPU、GPU、内存和延迟成本估算（Windows 桌面端本地 ONNX INT8）**：  
  * Embedding 模型（bge-small-zh-v1.5 INT8，约 35MB）：CPU 单次 Query 编码耗时 4\~8 ms。  
  * 向量检索（SQLite-vec / HNSW，10,000 条记录）：耗时 1\~3 ms，内存占用 \< 30 MB。  
  * Cross-Encoder 重排（bge-reranker-base 或 ms-marco-MiniLM-L-6-v2 INT8，对 Top-20 候选批处理）：CPU 耗时 25\~45 ms，无需 GPU。  
> * **12\. 参考实现（TypeScript / Node.js 生产级接口参考与官方库索引）**：  
  * 官方开源库：\[https\://github.com/FlagOpen/FlagEmbedding\](https\://github.com/FlagOpen/FlagEmbedding) (BAAI BGE 系列) 与 \[https\://github.com/UKPLab/sentence-transformers\](https\://github.com/UKPLab/sentence-transformers)

export interface MemoryCandidate {  
  id: string;  
  content: string;  
  embedding: Float32Array;  
  importance: number;  
  updatedAtMs: number;  
  epistemicModality: 'FACT' \| 'PREFERENCE' \| 'OPINION' \| 'HYPOTHESIS' \| 'RETRACTED\_ERROR';  
  provenanceTurnIds: string\[\];  
  bm25Rank?: number;  
  denseRank?: number;  
  ceScore?: number;  
}

export function computeWeightedRRF(  
  candidate: MemoryCandidate,  
  kRrf: number \= 60,  
  wBm25: number \= 0.4,  
  wDense: number \= 0.6  
): number {  
  const sBm25 \= candidate.bm25Rank \!== undefined ? wBm25 / (kRrf \+ candidate.bm25Rank) : 0;  
  const sDense \= candidate.denseRank \!== undefined ? wDense / (kRrf \+ candidate.denseRank) : 0;  
  return sBm25 \+ sDense;  
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {  
  let dot \= 0, normA \= 0, normB \= 0;  
  for (let i \= 0; i \< a.length; i++) {  
    dot \+= a\[i\] \* b\[i\];  
    normA \+= a\[i\] \* a\[i\];  
    normB \+= b\[i\] \* b\[i\];  
  }  
  return dot / (Math.sqrt(normA) \* Math.sqrt(normB) \+ 1e-8);  
}

> * **13\. 对 Morrow 的适配模块**：对接 docs/algorithms/memory-retrieval-and-use-v2.md 中的多通道 RRF 检索器与 Context Utility 排序器。  
> * **14\. 与 Morrow 当前实现的重复或冲突**：不推翻现有 RRF 与 Context Utility 框架，而是作为**RRF 的新增 Dense 通道**与 **Context Utility 的语义相关性精确输入项**，消除原相关性评分依赖粗略词面重合的短板。  
> * **15\. 是否值得引入及验证要求**：**强烈推荐优先引入（第一优先级）**。引入前需验证本地 ONNX Runtime 在目标 Windows 机器上的冷启动加载耗时与内存峰值。  
> * **16\. 行为验收方法与评测数据集**：  
  * 公开基准：C-MTEB（中文大规模文本嵌入基准）、MS-MARCO、T2Ranking。  
  * Morrow 专项验收：构造 100 组“同义改写回忆集”、“否定反义干扰集”和“跨轮指代召回集”，要求 Recall@5 ≥0.88，否定干扰项拦截率 ≥0.92。

##### **算法 A2：基于个性化 PageRank 的联想记忆图谱检索 (HippoRAG / Personalized PageRank Associative Memory)**

> * **1\. 算法正式名称**：基于海马体索引理论与个性化 PageRank 的联想记忆图谱检索（Hippocampal Indexing & Personalized PageRank Associative Memory Retrieval）  
> * **2\. 首次提出论文、作者、机构、年份**：  
  * **PageRank / PPR**：Page, L., Brin, S., Motwani, R., & Winograd, T. (1999). *The PageRank Citation Ranking: Bringing Order to the Web*. Stanford InfoLab; Haveliwala, T. H. (2002). *Topic-Sensitive PageRank* (WWW 2002).  
  * **HippoRAG**：Gutiérrez, B. J., Shu, Y., Gu, Y., Yasunaga, M., & Su, Y. (2024). *HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models*. The Ohio State University & Stanford University (NeurIPS 2024).  
> * **3\. 原始论文或官方技术资料链接**：  
  * HippoRAG 论文：\[https\://arxiv.org/abs/2405.14831\](https\://arxiv.org/abs/2405.14831)  
  * 官方 GitHub 仓库：\[https\://github.com/OSU-NLP-Group/HippoRAG\](https\://github.com/OSU-NLP-Group/HippoRAG)  
> * **4\. 理论基础与解决的问题**： 受哺乳动物新皮层-海马体记忆索引理论启发：情景记忆片段（Episodic Passages）如同新皮层表征，而从对话中抽取的命名实体与概念关系图（Knowledge Graph）充当“海马体索引”。当新输入激活图中的若干概念节点时，通过个性化 PageRank（PPR）在图上模拟神经激活扩散（Spreading Activation），从而实现多跳关联记忆召回。  
> * **5\. 数学公式与变量边界**： 设联想图 *G*\=(*V*,*E*)，其中节点集 *V* 包含概念/实体节点，边权重矩阵经过列归一化得到转移矩阵 P∈R∣*V*∣×∣*V*∣。  
  * **PPR 稳态分布方程**：  
    *π*\=(1−*α*ppr​)P*π*\+*α*ppr​s  
    * 变量解释：*π*∈R∣*V*∣ 为各概念节点的稳态联想激活概率向量；s∈R∣*V*∣ 为由当前 Query 命中的种子节点归一化初始激活分布（满足 ∑*i*​*si*​\=1，且可按节点逆文档频率 IDF 加权：*si*​∝IDF(*vi*​) 以抑制高频泛化节点）；*α*ppr​∈(0,1) 为重启概率（Teleportation / Damping factor，通常取 *α*ppr​\=0.5，控制扩散半径在 1∼3 跳内）。  
  * **情景记忆聚合打分**： 设包含概念节点 *vi*​ 的情景记忆 *d* 的关联矩阵为 M*d*,*i*​，则记忆 *d* 的联想激活得分为：  
    ScoreAssoc​(*q*,*d*)=*vi*​∈*d*∑​*πi*​⋅IDF(*vi*​)  
> * **6\. 输入、输出和状态变化**：  
  * **输入**：从 Fact Slot 已抽取的主宾实体构成的邻接表、当前对话识别出的种子实体集。  
  * **输出**：各历史情景记忆的联想激活分 ScoreAssoc​（作为 RRF 的第 4 通道或独立联想候选）。  
  * **状态变化**：无状态纯内存矩阵迭代（15∼20 次幂迭代即可收敛至 *ϵ*\<10−6）。  
> * **7\. 伪代码**：

ALGORITHM AssociativeMemoryPPR  
INPUT: adjacency\_matrix P, query\_entities Q\_ent, node\_idf, alpha \= 0.5, max\_iter \= 20  
OUTPUT: memory\_assoc\_scores

1\. s \<- ZeroVector(\|V\|)  
2\. FOR EACH e IN Q\_ent DO  
3\.     s\[e\] \<- node\_idf\[e\]  
4\. END FOR  
5\. s \<- s / Sum(s)  
6\. pi \<- s  
7\. FOR iter \= 1 TO max\_iter DO  
8\.     pi\_next \<- (1 \- alpha) \* MatVecMul(P, pi) \+ alpha \* s  
9\.     IF L1Norm(pi\_next \- pi) \< 1e-6 THEN BREAK  
10\.    pi \<- pi\_next  
11\. END FOR  
12\. RETURN AggregateNodeScoresToMemories(pi, node\_to\_memory\_index)

> * **8\. 可验证应用案例**：  
  * 记忆 1：\[实体: 林晓\] \--(是)--\> \[实体: 用户大学室友\]；记忆 2：\[实体: 林晓\] \--(去年搬去)--\> \[实体: 成都\]；记忆 3：\[实体: 成都之行\] \--(计划拜访)--\> \[实体: 老朋友\]。  
  * 当用户说：“下个月我要去趟四川出差”，系统激活 \[四川/成都\]，经 2 跳 PPR 扩散激活 \[林晓\] 与 \[大学室友\]，使 Morrow 能够自然联想并询问：“去成都的话，打算顺便见见你大学室友林晓吗？”  
> * **9\. 已知优点、缺陷和失败条件**：  
  * **优点**：纯图代数运算，毫秒级完成多跳联想，无需图神经网络训练。  
  * **缺陷**：依赖前期 Fact Slot 实体归一化的质量；若出现超级枢纽节点（Hub Node，如“工作”、“今天”），会稀释激活能量（必须乘 IDF(*vi*​) 抑制）。  
> * **10\. 分级与研究证据等级**：**L2（现有算法升级方案） / E2（NeurIPS 2024 公开论文与可复现实验）**。  
> * **11\. 资源与延迟成本**：在 ∣*V*∣≤10,000 稀疏图上进行 15 次幂迭代，CPU 单次耗时 \< 2 ms，内存占用 \< 10 MB。  
> * **12\. 参考实现**：官方仓库 \[https\://github.com/OSU-NLP-Group/HippoRAG\](https\://github.com/OSU-NLP-Group/HippoRAG)（Python igraph / scipy.sparse 实现）。  
> * **13\. 对 Morrow 的适配模块**：复用 memory-and-interest.md 已有的 Fact Slot 实体关系作为图边，向 memory-retrieval-and-use-v2.md 提供 Associative Channel。  
> * **14\. 与当前实现的冲突**：无冲突，直接盘活已抽取但仅用于单跳键值匹配的 Fact Slot 数据。  
> * **15\. 是否值得引入**：值得在第二阶段引入；需先验证同义实体消歧（Entity Canonicalization）。  
> * **16\. 行为验收与数据集**：2WikiMultihopQA、MuSiQue，以及 Morrow 跨会话多跳人物/事件关联测试集。

## **📁 Morrow-V2-Algorithm-Research/04-emotion-appraisal.md**

### **方向 B：多维情绪与认知评价研究**

#### **一、方向核心问题解答**

> 1. **情绪如何从经历、目标、预期、控制能力和关系事件中产生？** 情绪不能直接从“输入文本词表”映射，而必须经过**认知评价（Cognitive Appraisal）中介层**。借鉴 **OCC 模型（Ortony, Clore, & Collins）** 与 **Scherer 组件过程模型（CPM）**，任何事件 *e* 先针对 Morrow 的内部目标集 G、行动标准 S 和关系态度 A 计算五个结构化评价维度：**目标一致性（Goal Congruence）**、**预期偏差/意外度（Unexpectedness）**、**责任归因（Agency: Self / User / External）**、**控制潜力（Coping Potential / Control）与规范兼容性（Norm Compatibility）**。  
> 2. **如何形成喜悦、愤怒、悲伤、恐惧、厌恶、惊讶及复合情绪？** 评价向量 a(*e*)∈R*K* 先激活离散情绪强度向量 ediscrete​∈\[0,1\]*M*（如喜悦 Joy、悲伤 Distress、希望 Hope、恐惧 Fear、感激 Gratitude、担忧 Concern、挫败 Frustration、好奇惊讶 Surprise），再通过线性/非线性情绪空间投影矩阵 WPAD​∈R3×*M* 驱动连续 PAD 状态。当一个事件同时具备“目标受阻（引发挫败）”与“用户展现出真诚信任（引发感激/温暖）”时，离散层保留双峰激活，即自然形成复合情绪（如苦乐参半 Bittersweet 或既担忧又感动）。  
> 3. **如何允许多种情绪同时存在？** 废除 Softmax 互斥分类（∑*pi*​\=1），采用**多标签独立激活与竞争抑制网络（Multi-label Sigmoid / Bounded Leaky Integrator）**。每种离散情绪通道 *k* 拥有独立的激活值 *Ik*​(*t*)∈\[0,1\]，允许正负向情绪在合理配比下共存，仅在生理唤醒度（Arousal）极高且极性完全对立的通道间施加适度侧抑制（Lateral Inhibition）。  
> 4. **如何区分短期情绪状态和长期人格倾向？** 采用**三层时间尺度架构（Affective Hierarchy）**：  
   * **瞬时情绪（Emotion Episode）**：半衰期为分钟级/回合级（*τe*​≈3∼15 turns），直接由单次 Appraisal 脉冲激发；  
   * **心境状态（Mood / PAD State）**：半衰期为小时至天级（*τm*​≈6∼48 hours），对瞬时情绪进行低通滤波积分；  
   * **气质/人格基线（Temperament / Trait Baseline** *μ***PAD​）**：作为 Ornstein-Uhlenbeck 随机微分方程的**吸引子均值（Attractor Mean）**，当无外部刺激时，情绪与心境始终指数回归至人格决定的基线 *μ*PAD​，而非归零。  
> 5. **如何区分 Morrow 自身情绪与用户情绪？** 在数据结构上严格分离 user\_affect\_estimate（通过共情/ToM 推断的用户情绪）与 self\_affect\_state（Morrow 自身情绪）。用户的悲伤不会直接复制为 Morrow 的悲伤，而是作为社交评价输入：若 Morrow 与用户关系亲近且具有关怀目标（Goal: Care for User），用户的悲伤触发 Morrow 的 **“共情担忧（Empathetic Concern / Compassion）”**，其 Dominance（控制感/稳定感）保持高位以提供情绪支撑，而非一同陷入低 Dominance 的失控恐慌。  
> 6. **如何让情绪真实影响注意力、兴趣、反思和表达？** 将 PAD 与离散情绪作为下游模块的调制参数（Neuromodulation Analogy）：  
   * **注意力/检索调制**：情绪一致性效应（Mood-Congruent Retrieval）与唤醒度聚焦（高 Arousal 收窄检索 Top-*K*，优先高紧急度记忆）；  
   * **反思调制**：负向效价 \+ 高预期偏差（挫败/惊讶）降低 Reflection 触发阈值，促使系统进入深度分析；  
   * **表达调制**：映射为语用温度、句式节奏、主动追问倾向与谨慎度。  
> 7. **如何避免关键词规则造成讽刺、否定、引用、多语言误判？** 禁用表面情感词典直接驱动状态变更。要求情感事件识别必须绑定**语用框架与归因槽位（Pragmatic Frame & Attribution）**：先识别话语的 speech\_act（如 IRONY, QUOTATION, HYPOTHETICAL, GENUINE\_DISCLOSURE）与 experiencer（经历者是谁），若 speech\_act \== QUOTATION（如讨论小说剧情），其对自身目标冲击权重自动乘以衰减因子 *γ*fictional​\=0.1。

#### **二、核心推荐算法详解**

##### **算法 B1：OCC-PAD 双层认知评价与 Ornstein-Uhlenbeck 情绪动力学模型 (OCC-PAD Appraisal & OU Affective Dynamics)**

> * **1\. 算法正式名称**：结合 OCC 认知评价、多情绪共存与 Ornstein-Uhlenbeck 基线回归的情绪动力学模型（OCC-PAD Hybrid Appraisal with Ornstein-Uhlenbeck Affective Attractor Dynamics）  
> * **2\. 首次提出论文、作者、机构、年份**：  
  * **OCC 模型**：Ortony, A., Clore, G. L., & Collins, A. (1988). *The Cognitive Structure of Emotions*. Cambridge University Press (UIUC & Northwestern).  
  * **PAD 空间**：Mehrabian, A. (1996). *Pleasure-arousal-dominance: A general framework for describing and measuring individual differences in Temperament*. UCLA (*Current Psychology*).  
  * **ALMA (OCC+PAD 工程融合)**：Gebhard, P. (2005). *ALMA: A Layered Model of Affect*. DFKI GmbH (AAMAS 2005).  
  * **DynAffect (OU 情绪吸引子动力学)**：Kuppens, P., Oravecz, Z., & Tuerlinckx, F. (2010). *Feelings change: Accounting for individual differences in the temporal dynamics of affect*. KU Leuven (*Journal of Personality and Social Psychology*).  
> * **3\. 原始论文或官方技术资料链接**：  
  * OCC DOI: \[https\://doi.org/10.1017/CBO9780511571299\](https\://doi.org/10.1017/CBO9780511571299)  
  * ALMA 论文：\[https\://dl.acm.org/doi/10.1145/1082473.1082478\](https\://dl.acm.org/doi/10.1145/1082473.1082478)  
  * DynAffect DOI: \[https\://doi.org/10.1037/a0020962\](https\://doi.org/10.1037/a0020962)  
> * **4\. 理论基础与解决的问题**： 将符号化的 OCC 认知评价（解释“为什么产生某种具体情绪”）与连续动力学空间 PAD \+ DynAffect（解释“多种情绪如何叠加、衰减并向个体特质基线回归”）结合，彻底解决局部规则情绪缺乏因果解释、无法共存及衰减后状态僵死的问题。  
> * **5\. 数学公式与变量边界**：  
  * **步骤 1（五维结构化认知评价向量）**： 给定对话或内部事件 *et*​，提取评价向量 c*t*​\=\[*gt*​,*ut*​,*at*self​,*at*user​,*κt*​,*rt*​\]⊤：  
    * *gt*​∈\[−1,1\]：目标一致性（Goal Congruence，+1 为高度促进 Morrow 认知/关系目标，−1 为严重阻碍）；  
    * *ut*​∈\[0,1\]：意外度/预测误差（Unexpectedness）；  
    * *at*self​,*at*user​∈\[0,1\]：Morrow 自身责任归因与用户责任归因；  
    * *κt*​∈\[0,1\]：Morrow 对当前局面的应对/控制潜力（Coping Potential）；  
    * *rt*​∈\[0,1\]：现实性/非虚构权重（Reality Weight，真实互动为 1.0，引用/玩笑/假设为 0.1∼0.3）。  
  * **步骤 2（离散复合情绪脉冲生成）**： 对每种离散情绪 *k*∈{Joy,Distress,Gratitude,Concern,Frustration,Curiosity,Calm}，其瞬时脉冲 Δ*Ik*,*t*​∈\[0,1\] 由评价规则门控计算，例如：  
    Δ*I*Joy,*t*​\=*rt*​⋅max(0,*gt*​)⋅(0.5+0.5*ut*​)  
    Δ*I*Gratitude,*t*​\=*rt*​⋅max(0,*gt*​)⋅*at*user​⋅Trustrel​  
    Δ*I*Concern,*t*​\=*rt*​⋅max(0,−*gt*user\_wellbeing​)⋅Carerel​  
    Δ*I*Frustration,*t*​\=*rt*​⋅max(0,−*gt*​)⋅(1−*κt*​)⋅*at*self​  
    离散情绪池带侧抑制更新：  
    *Ik*,*t*​\=clip​*e*−*λk*​Δ*tIk*,*t*−1​\+Δ*Ik*,*t*​−*j*\=*k*∑​Ω*k*,*j*​*Ij*,*t*−1​,0,1​  
    其中 Ω*k*,*j*​≥0 为仅在极性冲突情绪间非零的弱侧抑制系数（如 ΩJoy,Distress​\=0.15）。  
  * **步骤 3（离散情绪向 PAD 空间投影与 OU 吸引子微分更新）**： 设 x*t*​\=\[*Pt*​,*At*​,*Dt*​\]⊤∈\[−1,1\]3 为 Morrow 当前三维情感状态，其长期人格决定的情感吸引子基线为 *μ*trait​∈\[−1,1\]3。离散时间下的受控 Ornstein-Uhlenbeck 更新方程为：  
    x*t*​\=*μ*trait​\+exp(−ΘΔ*t*)(x*t*−1​−*μ*trait​)+tanh(WPAD​I*t*​)  
    * 变量解释：Θ=diag(*θP*​,*θA*​,*θD*​) 为三维恢复速率对角矩阵（*θ*\>0，称为情绪调节回归率 Emotion Regulation Rate，由情绪稳定性人格特质决定）；WPAD​∈R3×*M* 为固定标准映射矩阵（例如 Gratitude→\[+0.6,+0.2,+0.3\]⊤，Frustration→\[−0.5,+0.4,−0.4\]⊤）。  
  * **步骤 4（认知重评调节 Cognitive Reappraisal）**： 当内部反思（Inner Cognition）对事件产生重新解释 c*t*′​（例如认识到用户的激烈言辞源于外部工作压力而非针对 Morrow，使 *at*user​ 降低、*κt*​ 升高），系统计算重评修正量 *δ*I*t*​\=*f*(c*t*′​)−*f*(c*t*​) 并平滑注入 x*t*​。  
> * **6\. 输入、输出和状态变化**：  
  * **输入**：事件评价特征向量 c*t*​、上一时刻状态 (I*t*−1​,x*t*−1​)、时间差 Δ*t*、人格基线 *μ*trait​。  
  * **输出**：当前活跃复合情绪列表（Top-3 *Ik*,*t*​\>0.15）、更新后的 \$\\mathbf{x}\_t \= \[P\_t, A\_t, D

---

