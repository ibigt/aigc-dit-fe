import { createContext, useContext } from "react";

// WorkflowStudio provides callbacks here; node data contains serializable parameters and runtime only.
// updateMedia(id, patch), updatePrompt(id, patch), updateClips(id, clips), execute(id), remove(id),
// uploadAudio(file) -> { storageKey, url, name, duration }, getClips(id) -> clips,
// getEditingSources(id) -> [{ id, title, status, enabled }]（剪辑节点上游视频源，含失败/生成中状态）,
// refreshRuntime() -> Promise<boolean>（重拉运行时快照，换最新产物地址，需求 4.2.5.9）,
// toggleLock(id), toggleCollapse(id), models -> catalog,
// runMode -> "reuse" | "regenerate"（顶栏运行方式；generateMedia/execute 会据此带 forceRegenerate，需求 4.6.2）.
export const WorkflowNodeContext = createContext({
  updateMedia: () => {},
  updatePrompt: () => {},
  updateClips: () => {},
  selectOutput: () => {},
  execute: () => {},
  remove: () => {},
  uploadAudio: async () => null,
  getClips: () => [],
  getEditingSources: () => [],
  // 独立剪辑台（UC-AIGC-V1C20-007）：openEditingSuite(id) 打开全屏工作区，
  // updateEditingDraft(id, {timeline, clips}) 双写草稿，commitEditingExport(id) 导出成片并写回节点。
  openEditingSuite: () => {},
  updateEditingDraft: () => {},
  commitEditingExport: async () => {},
  toggleLock: () => {},
  toggleCollapse: () => {},
  getVariableScopes: () => [],
  getReferences: () => [],
  removeReference: () => {},
  openReferencePicker: () => {},
  refreshRuntime: async () => false,
  running: false,
  models: [],
  runMode: "reuse",
});

export const useWorkflowNode = () => useContext(WorkflowNodeContext);
