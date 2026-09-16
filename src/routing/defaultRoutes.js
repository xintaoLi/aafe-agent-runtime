export const DEFAULT_SEMANTIC_ROUTES = Object.freeze([
  { id: 'chat.answer', utterances: ['解释这个概念', '这是什么意思', '怎么使用这个命令'],
    result: { relation: 'new', domain: 'chat', action: 'answer', complexity: 'L0', risk: 'low' } },
  { id: 'coding.fix', utterances: ['修复这个报错', '定位页面白屏', '接口请求失败怎么解决', '排查内存泄漏'],
    result: { relation: 'new', domain: 'coding', action: 'fix', complexity: 'L2', risk: 'medium', requiredCapabilities: ['file-read', 'file-write', 'shell'] } },
  { id: 'coding.implement', utterances: ['实现这个功能', '增加一个配置开关', '修改这个文件', '补充单元测试'],
    result: { relation: 'new', domain: 'coding', action: 'implement', complexity: 'L1', risk: 'medium', requiredCapabilities: ['file-read', 'file-write'] } },
  { id: 'coding.review', utterances: ['代码审查', '检查 diff', 'review 这次改动'],
    result: { relation: 'new', domain: 'coding', action: 'review', complexity: 'L2', risk: 'low', requiredCapabilities: ['file-read'] } },
  { id: 'testing.e2e', utterances: ['执行 Playwright 测试', '运行端到端测试', '验证登录流程'],
    result: { relation: 'new', domain: 'testing', action: 'test', complexity: 'L2', risk: 'medium', requiredCapabilities: ['file-read', 'shell'] } },
  { id: 'analysis.architecture', utterances: ['分析架构', '设计跨模块方案', '评估系统影响面'],
    result: { relation: 'new', domain: 'analysis', action: 'plan', complexity: 'L3', risk: 'low', requiredCapabilities: ['file-read'] } }
]);
