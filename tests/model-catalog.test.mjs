import test from "node:test";
import assert from "node:assert/strict";
import { managedModelCatalog, modelCatalogMessage } from "../src/lib/modelCatalog.js";

test("managed model catalog preserves an explicit empty server result", () => {
  assert.deepEqual(managedModelCatalog([]), []);
  assert.deepEqual(managedModelCatalog(undefined), []);
  assert.deepEqual(managedModelCatalog([{ id: 1 }]), [{ id: 1 }]);
});

test("empty model message follows loading error and category state", () => {
  assert.match(modelCatalogMessage({ loading: true, category: "video" }), /加载/);
  assert.match(modelCatalogMessage({ error: new Error("offline"), category: "video" }), /失败/);
  assert.match(modelCatalogMessage({ category: "audio" }), /语音/);
});
