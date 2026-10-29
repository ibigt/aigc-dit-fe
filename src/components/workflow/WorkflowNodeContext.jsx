import { createContext, useContext } from "react";

// WorkflowStudio provides callbacks here; node data contains serializable parameters and runtime only.
// updateMedia(id, patch), updatePrompt(id, patch), updateClips(id, clips), execute(id), remove(id),
// uploadAudio(file) -> { storageKey, url, name, duration }, getClips(id) -> clips,
// getEditingSources(id) -> [{ id, title, status, enabled }]（剪辑节点上游视频源，含失败/生成中状态）,
// toggleLock(id), toggleCollapse(id), models -> catalog.
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
  toggleLock: () => {},
  toggleCollapse: () => {},
  getVariableScopes: () => [],
  getReferences: () => [],
  removeReference: () => {},
  openReferencePicker: () => {},
  running: false,
  models: [],
});

export const useWorkflowNode = () => useContext(WorkflowNodeContext);
