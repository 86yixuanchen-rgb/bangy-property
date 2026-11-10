// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractPropertyAddress, isPropertyCreation } from "@/lib/assistant-property";
describe("Assistant property intent and conservative address prefill", () => {
  it("recognises the user's mixed-language creation request", () => {
    expect(isPropertyCreation("帮我创建一下这个property")).toBe(true);
    expect(isPropertyCreation("Add this property")).toBe(true);
    expect(isPropertyCreation("What is this property?")).toBe(false);
  });
  it("extracts an address from a repair subject without retaining its instruction", () => {
    expect(extractPropertyAddress("21 Diana Street, Schofields - Please fix tap")).toBe(
      "21 Diana Street, Schofields",
    );
  });
  it("leaves unknown addresses blank rather than inventing a property", () => {
    expect(extractPropertyAddress("Please fix the kitchen tap")).toBe("");
  });
});
