import { describe, expect, it } from "vitest";
import { formatPhoneForExcel, normalizePhone } from "./phone";

describe("телефонные номера", () => {
  it.each([
    ["+7 (928) 123-45-67", "8-928-123-45-67"],
    ["8 928 123 45 67", "8-928-123-45-67"],
    ["79281234567", "8-928-123-45-67"],
    ["9281234567", "8-928-123-45-67"],
  ])("выгружает %s в едином формате", (source, expected) => {
    expect(formatPhoneForExcel(source)).toBe(expected);
  });

  it("не придумывает номер из некорректного значения", () => {
    expect(normalizePhone("12345")).toBe("");
    expect(formatPhoneForExcel("12345")).toBe("12345");
  });
});
