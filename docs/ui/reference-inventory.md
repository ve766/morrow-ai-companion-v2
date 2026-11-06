# UI 参考资料清单与实际解读

任务要求先登记、再实现。以下文件均在用户提供的 `E:\open ui\auto ui\` 工作区中实际读取；没有把未看到的图片或设计稿写成已读。

| 文件 | 类型 | 读取状态 | 参考用途 | 对应页面/组件 |
| --- | --- | --- | --- | --- |
| `E:\open ui\auto ui\spatial.html` | HTML/CSS/JS 单文件 | 已读（完整） | 深空底色、轨道/点云、mono 标签、lime/cyan/violet 强调、拖拽环绕 | 主对话页 hero、presence canvas、整体深色主题 |
| `E:\open ui\auto ui\agentic-lab.html` | HTML/CSS/JS 单文件 | 已读（完整） | 纸面工作台、细线卡片、状态胶囊、审批/任务信息的层次；仅用于控制面，不用于主对话构图 | 设置页、Provider/认知/备份、状态与错误反馈 |
| `E:\open ui\auto ui\designs-lab.html` | HTML/CSS/JS 单文件 | 已读（完整） | 10×10 样张墙、编号/元数据、卡片密度、编辑式标题与筛选 | 记忆/目标卡片、settings index、列表密度 |
| `E:\open ui\auto ui\_morrow\memory-vault.src.html` | Morrow 记忆穹窖源码模板 | 已读（结构/样式/交互段落） | 单色记忆节点、来源/置信度/修订链、敏感级、检索点亮 | 记忆页的信息语义；未直接复用 three.js 运行时 |
| `E:\open ui\auto ui\zcode-morrow\README.md` | 说明 | 已读 | 记忆库能力边界、敏感级默认脱敏、只读声明 | 记忆页文案与“不自动写入”边界 |
| `E:\open ui\auto ui\PROJECT-NOTES.md` | 项目记录 | 已读（Morrow/记忆穹窖相关段落） | 组织学式排布、单色按钮系统、QA 经验 | 记忆/兴趣卡片的视觉语言 |

## 冲突与取舍

三份博物馆页面不是三套互斥的皮肤，而是同一设计系统的三个翼：

- `spatial.html` 是深色空间翼，负责“陪伴感/存在感”；
- `agentic-lab.html` 是纸面工作台翼，负责“可控/可审阅”；
- `designs-lab.html` 是样张索引翼，负责“密度/编号/检索”。

Morrow 是 AI 伴侣，不是 Agent 控制台。因此：

- 主对话页采用空间翼的构图（hero + 轨道点云 + 对话流 + 浮动输入），不采用 Agent Desk 的任务流/工具卡布局；
- 设置与 Provider 采用纸面工作台的细线卡片与状态胶囊，但保留空间翼的深色基底，避免产品被拆成两套主题；
- 记忆/目标采用样张索引的卡片与编号语言，记忆语义参考 `memory-vault` 的来源/修订链/敏感级，而不是把 3D 穹窖直接搬进 Electron。

没有把参考中的具体品牌名、价格或外部依赖带入产品；`three.js`/`rapier3d` 等只是参考资料中的运行时，Morrow 仍使用原生 Canvas 2D 与既有 Electron 栈。

## 未提供的参考

没有收到单独的图片、Figma、字体文件或品牌手册。若用户后续提供主参考图，应以该图重新校准色板/构图；当前实现按上述三翼的共同语法落地，并在 `docs/ui/design-system.md` 中记录可替换的 token。
