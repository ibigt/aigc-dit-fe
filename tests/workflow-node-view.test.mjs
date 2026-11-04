import test from "node:test";
import assert from "node:assert/strict";
import { nodeViewModel } from "../src/components/workflow/nodeViewModel.js";

test("selects in-card controls and runtime presentation", () => {
  assert.deepEqual(nodeViewModel("AudioGenerator", { tab: "speech" }, { status: "IDLE" }).tabs,
    ["配音朗读", "AI 音乐"]);
  assert.equal(nodeViewModel("VideoGenerator", {}, { status: "RUNNING", progress: 42 }).actionLabel,
    "生成中 42%");
  assert.equal(nodeViewModel("VideoEditing", {}, { status: "SUCCEEDED" }).actionLabel,
    "重新合成");
  assert.equal(nodeViewModel("VideoEditing", {}, {}).hasOutputHandle, false);
});

test("runtime state controls execution and selected output", () => {
  const running = nodeViewModel("ImageGenerator", {}, { status: "RUNNING", progress: 130 });
  assert.equal(running.actionDisabled, true);
  assert.equal(running.actionLabel, "生成中 100%");
  const succeeded = nodeViewModel("VideoGenerator", {}, { status: "SUCCEEDED", outputs: [
    { storageKey: "first", url: "/first.mp4" },
    { storageKey: "second", url: "/second.mp4" },
  ] });
  assert.equal(succeeded.selectedOutput.url, "/first.mp4");
  assert.equal(succeeded.actionLabel, "执行生成");
  assert.equal(nodeViewModel("Prompt", {}, {}).hasInputHandle, true);
  assert.equal(nodeViewModel("Prompt", {}, {}).hasOutputHandle, true);
});

test("every media grid uses the durable selected index with first-copy fallback", () => {
  const outputs = [{ storageKey: "users/7/one", url: "/one" }, { storageKey: "users/7/two", url: "/two" }];
  for (const kind of ["ImageGenerator", "AudioGenerator", "VideoGenerator"]) {
    assert.equal(nodeViewModel(kind, { outputIndex: 1 }, { outputs }).selectedOutput.storageKey, "users/7/two");
    assert.equal(nodeViewModel(kind, { outputIndex: 99 }, { outputs }).selectedOutput.storageKey, "users/7/one");
  }
});

test("uploaded audio selection survives a saved card and keeps its audio type", () => {
  const uploadedAudio = { type: "audio", storageKey: "users/7/local.wav", url: "/local.wav" };
  const view = nodeViewModel("AudioGenerator", { uploadedAudio, selectedAudioSource: "uploaded" }, { outputs: [{ type: "audio", storageKey: "users/7/generated.wav", url: "/generated.wav" }] });
  assert.equal(view.selectedOutput.storageKey, "users/7/local.wav");
  assert.equal(view.selectedOutput.type, "audio");
});

test("a completed uploaded-audio step does not masquerade as a generated source", () => {
  const uploadedAudio = { type: "audio", storageKey: "users/7/local.wav", url: "/local.wav" };
  const view = nodeViewModel("AudioGenerator", { uploadedAudio, selectedAudioSource: "uploaded" }, {
    status: "SUCCEEDED", outputs: [{ ...uploadedAudio }],
  });
  assert.equal(view.selectedOutput.storageKey, uploadedAudio.storageKey);
  assert.equal(view.generatedOutput, null);
});

test("respects persisted output selection and marks queued and blocked steps", () => {
  const outputs = [{ storageKey: "first", url: "/first.mp4" }, { storageKey: "second", url: "/second.mp4" }];
  assert.equal(nodeViewModel("VideoGenerator", { selectedOutputIndex: 1 }, { status: "SUCCEEDED", outputs }).selectedOutput.url, "/second.mp4");
  assert.equal(nodeViewModel("VideoGenerator", {}, { status: "SUBMITTING" }).actionDisabled, true);
  assert.equal(nodeViewModel("VideoEditing", {}, { status: "BLOCKED" }).hasError, true);
});

test("editing progress disables another compose request", () => {
  const view = nodeViewModel("VideoEditing", {}, { status: "EDITING", progress: 46 });
  assert.equal(view.isBusy, true);
  assert.equal(view.actionDisabled, true);
  assert.equal(view.actionLabel, "合成中 46%");
});

test("prompt view reports unresolved and conflicting placeholders", () => {
  const view = nodeViewModel("Prompt", {
    prompt: "A {{subject}} at {{place}} with {{tone}}",
    variables: { subject: "fox" },
    scopes: [{ priority: 0, values: { tone: "warm" } }, { priority: 0, values: { tone: "cold" } }],
  });
  assert.deepEqual(view.placeholders, ["subject", "place", "tone"]);
  assert.deepEqual(view.missing, ["place"]);
  assert.deepEqual(view.conflicts, ["tone"]);
});
