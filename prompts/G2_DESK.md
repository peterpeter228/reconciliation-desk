# G2 6 小时 上传 异常看板和交付包

## 目标

做可以向美国bookkeeper演示的英文桌面UI。先完成最常用任务路径，
不加入聊天机器人、自动写账或账户集成。

## 顺序与时间建议

- 1.5h：三框drag/drop、每源多文件、header确认、coverage摘要；本地解析和取消。
- 2h：exception列表金额排序、ST/QB/bank三列证据联动、formula解释、missing evidence。
- 1.5h：fee-only完整审批预览/QBO CSV/QBD IIF；UF操作底稿；support PDF。
- 1h：一键synthetic demo、映射缓存与可选LLM timeout fallback、Stripe测试Payment Link。

## 导出硬门

approved proposal绑定源hash+科目mapping+日期+金额+证据+规则版本，改任何一项需重审。
出口再次验证借贷、同一币种、科目白名单、单行单边、无公式危险文本。
QBO已记银行净收款时不再DrBank；已经记费不再出AJE。
UF输出Bank Deposit选原payments的工作表，不用JE冒充对象关联完成。
未通过目标QB版本试导的格式用Beta标记；不会给用户自动导入按钮。

## 交互验收

Demo无账号即可操作；20k和50k案例在前三十秒可看见；原始行/日期/金额
不在tooltip里被隐藏；所有核心操作可键盘使用。已有病例切换账套时清空状态。
下载后仍是EXPORTED而非VERIFIED_IN_QB，另提供再次上传GL入口。
Payment Link测试态不冒充收费成功；回跳参数不充当授权凭证。

交付可启动的UI、关键路径screenshots（内部验证）、E2E结果、示例导出包。
