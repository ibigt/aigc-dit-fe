export function textReasoningEnabled(adapterConfig) {
  return adapterConfig?.enableThinking === true;
}

export function withTextReasoning(adapterConfig, enabled = false) {
  return {
    ...(adapterConfig || {}),
    enableThinking: enabled === true,
  };
}
