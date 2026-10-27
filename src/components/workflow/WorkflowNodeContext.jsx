import { createContext, useContext } from "react";

// WorkflowStudio provides callbacks here; node data contains serializable parameters and runtime only.
// updateMedia(id, patch), updatePrompt(id, patch), updateClips(id, clips), execute(id),
// uploadAudio(file) -> { storageKey, url, name, duration }, getClips(id) -> clips, models -> catalog.
export const WorkflowNodeContext = createContext({
  updateMedia: () => {},
  updatePrompt: () => {},
  updateClips: () => {},
  selectOutput: () => {},
  execute: () => {},
  uploadAudio: async () => null,
  getClips: () => [],
  getVariableScopes: () => [],
  getReferences: () => [],
  removeReference: () => {},
  openReferencePicker: () => {},
  models: [],
});

export const useWorkflowNode = () => useContext(WorkflowNodeContext);
