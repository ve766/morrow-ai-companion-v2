# 用户提供的 Morrow 研究/复核材料（2026-11-08）

来源：`F:\chrome\morrow`，由用户要求随本次 GitHub 交付一起上传。

这些是任务书、复核记录和研究资料，不是运行时资源，不会被应用加载，也不改变 Issue #72 的任何行为结论。

## 提取结果与原始文件对应关系

用户提供的目录包含 **8 份 DOCX + 1 份原始 Markdown**（共 9 份文档）。8 份 DOCX 已逐份提取为同名 Markdown，原始 DOCX 保持原样，未修改、未删除、未重新打包。

| 原始文件 | 提取文件 | 原始大小 | Markdown 大小 |
|---|---|---:|---:|
| `Morrow V2 完结复核.docx` | `Morrow V2 完结复核.md` | 3,131,597 | 14,084 |
| `接着往后做.docx` | `接着往后做.md` | 3,149,004 | 34,954 |
| `继续完成未完成任务.docx` | `继续完成未完成任务.md` | 3,138,014 | 21,426 |
| `继续完成未完成任务，继续往后做.docx` | `继续完成未完成任务，继续往后做.md` | 3,146,239 | 30,939 |
| `继续完成未完成的任务.docx` | `继续完成未完成的任务.md` | 3,139,128 | 21,700 |
| `继续往后做.docx` | `继续往后做.md` | 3,135,610 | 18,400 |
| `请接着往后做.docx` | `请接着往后做.md` | 42,496 | 50,109 |
| `请继续往后做，做好一次性做完.docx` | `请继续往后做，做好一次性做完.md` | 3,139,735 | 21,353 |
| `Morrow V2 主体认知算法专项研究与储备库建设任务书_...（原文件名过长）.md` | `00-task-brief.md` | 68,588 | 68,588（原本已是 Markdown） |

第 9 份不是 DOCX，而是原始 Markdown；原文件名 321 bytes，会超过常见文件系统/GitHub 单路径组件限制，因此重命名为 `00-task-brief.md`，内容未改。

精确的 SHA-256、字节数和机器可读映射见 [`extraction-manifest.json`](extraction-manifest.json)。

## 提取规则

- 按 Word 的 `Heading 1`–`Heading 5` 样式还原 Markdown 标题层级。
- 普通段落保留原文、换行和行内粗体/斜体/等宽格式。
- 表格转换为 GitHub Flavored Markdown 表格，单元格内换行使用 `<br>`。
- 真实超链接转换为 `[文本](URL)`；纯 URL 使用 `<URL>`；
- 论文 DOI/arXiv/ACL 链接和代码仓库链接保留在对应段落。
- 公式没有 OMML 结构，原文以 Unicode 数学字符/上下标文本保存；提取时保留 Unicode，并把上下标转为 `<sub>`/`<sup>`。不伪造 LaTeX。
- 识别出的 SQL / TypeScript / 伪代码段使用 ```text 代码围栏，保留换行与缩进。
- 不修改原始 DOCX；不修改 Morrow 运行时代码。

## 校验

上传前用本地扫描检查了 `sk-`、API key/Bearer、长十六进制凭据和 `MORROW_*_KEY` 模式；命中的 `sk-performance-assessment` 是文件名 `14-risk-performance-assessment.md` 的一部分，不是密钥。未发现 API key、Runner token 或密码。
