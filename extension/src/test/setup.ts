import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { resetAwClientForTests } from "../background/aw-client";
import { resetBrainForTests } from "../background/brain";
import { resetLlmClientForTests } from "../background/llm-client";
import { resetStateForTests } from "../background/state";
import { resetTrackerForTests } from "../background/tracker";
import { installChrome } from "./chrome-mock";

beforeEach(() => {
  installChrome();
  resetStateForTests();
  resetLlmClientForTests();
  resetAwClientForTests();
  resetBrainForTests();
  resetTrackerForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
