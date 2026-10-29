import { test } from "node:test";
import assert from "node:assert/strict";
import { createMediaGate } from "../src/lib/mediaGate.js";

test("media gate holds requests above the limit until a slot is released", async () => {
  const gate = createMediaGate(2);
  const first = await gate.acquire();
  const second = await gate.acquire();
  let thirdStarted = false;
  const third = gate.acquire().then((release) => {
    thirdStarted = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(thirdStarted, false);

  first();
  const releaseThird = await third;
  assert.equal(thirdStarted, true);

  second();
  releaseThird();
  const fourth = await gate.acquire();
  fourth();
});

test("media gate ignores a second release of the same slot", async () => {
  const gate = createMediaGate(1);
  const release = await gate.acquire();
  let nextStarted = false;
  const next = gate.acquire().then((done) => {
    nextStarted = true;
    return done;
  });
  release();
  release();
  const done = await next;
  assert.equal(nextStarted, true);
  done();
});
