import { describe, expect, it } from "vitest";
import { percentOf } from "./percent";

describe("проценты в показателях", () => {
  it("одна цифра после запятой, без лишнего нуля", () => {
    expect(percentOf(7847651, 23262597)).toBe("33,7%");
    expect(percentOf(165, 202)).toBe("81,7%");
    expect(percentOf(50, 100)).toBe("50%");
    expect(percentOf(100, 100)).toBe("100%");
  });
  it("нулевая база — процент не показываем", () => {
    expect(percentOf(10, 0)).toBe("");
    expect(percentOf(10, undefined)).toBe("");
  });
  it("очень малая доля и ноль", () => {
    expect(percentOf(1, 100000)).toBe("<0,1%");
    expect(percentOf(0, 100)).toBe("0%");
  });
});
