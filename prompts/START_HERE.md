# 可直接交给 Cursor 或 Claude Code 的启动指令

你负责把本开发包做成 Reconciliation Desk MVP。先读 AGENTS.md，再读
docs/PRD_ENGINEERING.zh-CN.md、docs/ALGORITHM_SPEC.zh-CN.md、
docs/ACCOUNTING_EXPORT_SPEC.zh-CN.md 和 contracts/canonical.ts。

已选路线：React + TypeScript + Vite、浏览器Web Worker本地解析/对账，
Cloudflare Static Assets；LLM只辅助表头映射且可关闭。
18小时先做199美元人工复核诊断闭环，订阅多租户不是首日交付承诺。

请先运行合成生成器和现有测试，确认环境可用。然后执行G1，不先铺UI。
三个财务系统没有API连接；不得读取密钥、尝试登录或写账。缺真实文件与
QBO/QBD测试账套时保留格式兼容待验，不用假截图或测试数量冒充生产认证。

每阶段保存实现、测试结果和未决项到docs/phase-status.md。只在确实缺少
用户提供的真实账号/文件才说明阻塞；其余按PRD自主推进。

执行顺序：G1_ENGINE.md → G2_DESK.md → G3_VALIDATION.md → G4_LAUNCH.md。
完成一阶段检查其质量门，然后继续下一阶段。若累计工时触及18小时，按PRD
删减可选LLM/订阅/云保存等项，不能删会计正确性及证据门。
