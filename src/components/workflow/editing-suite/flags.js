// 剪辑台功能开关。
//
// 目的：让未交付的功能**入口先隐藏**，但代码与结构保留在仓库里，
// 下个版本直接把开关置 true 即可恢复，不需要重新考古。
//
// 约定：
// - 开关关闭时，入口按钮与对应面板**都不渲染**（不是用 CSS 藏），避免无入口却能通过状态切进去。
// - 被关闭功能的专属 UI 分支一并隐藏，避免留下点不到的占位内容。

/**
 * 剪辑助手一期：剪辑台里的本地动作面板（播放器入口 + 右栏「助手」页）。
 *
 * 每个按钮是一条受限动作（op 枚举 + presetId 白名单 + clipIds 引用）。
 * 前端校验后用 `model.js` 既有纯函数改写 timeline，不直接写时间线。
 * 一批动作一次 `store.commit`，Ctrl+Z 整步撤回。
 * 落稿后 `exportFlatClips` / `exportClipStyles` / `exportOverlays` 自动带上，导出链路不改。
 *
 * 不在本期：对话模型、`POST /api/workflows/editing/assistant`、
 * 自动配乐（无音乐模型）、一键字幕（无语音识别模型）。
 */
export const EDITING_ASSISTANT_ENABLED = true;
