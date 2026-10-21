# G3 3 小时 反例 压测和隐私验证

## 目标

不是增加测试数量；验证财务错配、错误导入、原始资料外发三项核心风险。

1. 独立构造反例：同金额两解、9% reserve、3% refund、单独开票费用、
   含refund负数、locked原付款+新correction、月底right-censor、银行已记重复fee。
2. 文件边界：同文件重传/跨文件overlap、account mismatch、缺opening、
   summary+detail、无表头、重复表头、MM/DD与Excel1904、括号负数、空金额、
   恶意公式和NUL/TAB、XLSX过大压缩比/外链/宏/关键公式。
3. 性能：在记录型号的Chrome/Edge桌面跑warm 100次和cold 10次。
   3,000为整月行规模，report按stage列parse/map/engine/PDF；
   engine p95目标500ms，同时列出cap/timeout、歧义率和错误接受数。
   任何超时不可变为NO_MATCH；达到预算给部分确定结果和未完成状态。
4. 网络：监听fetch，证明raw行、姓名、memo、完整金额/账号不发往mapper；
   Demo不调用LLM；cache命中零网络零token；日志不含payload；无session replay。
5. 验证同一proposal的账户/日期修改会让批准失效；CSV与IIF出口再校验。
   QBD partial-success演练仅重试failed；待目标版本测试时禁贴verified徽标。

输出docs/validation-report.md，标明每项PASS/FAIL/NOT_RUN及命令证据。
只有synthetic结果不能宣布production ready。修复高风险项后停止无关测试，进入G4。
