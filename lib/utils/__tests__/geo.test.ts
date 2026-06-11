import { describe, expect, it } from "vitest";
import { distanceMeters, formatDistanceMeters } from "../geo";

describe("distanceMeters", () => {
  it("同一座標の距離は0に近い", () => {
    expect(distanceMeters(35.6762, 139.6503, 35.6762, 139.6503)).toBeCloseTo(0, 5);
  });

  it("50m以内の2点 (緯度差0.0004° ≈ 44m) は 50 未満を返す", () => {
    const d = distanceMeters(35.6762, 139.6503, 35.6762 + 0.0004, 139.6503);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(50);
  });

  it("50mを超える2点 (緯度差0.0005° ≈ 56m) は 50 以上を返す", () => {
    const d = distanceMeters(35.6762, 139.6503, 35.6762 + 0.0005, 139.6503);
    expect(d).toBeGreaterThanOrEqual(50);
  });

  it("渋谷〜新宿間 (約3.4km) は妥当な距離を返す", () => {
    // 渋谷駅: 35.6580, 139.7016 / 新宿駅: 35.6896, 139.6917
    const d = distanceMeters(35.658, 139.7016, 35.6896, 139.6917);
    expect(d).toBeGreaterThan(3_000);
    expect(d).toBeLessThan(4_000);
  });

  it("北緯・東経を跨ぐ計算でも正の値を返す", () => {
    const d = distanceMeters(35.0, 139.0, 35.001, 139.001);
    expect(d).toBeGreaterThan(0);
  });
});

describe("formatDistanceMeters", () => {
  it("1000m未満は整数メートルで表示する", () => {
    expect(formatDistanceMeters(320)).toBe("320m");
    expect(formatDistanceMeters(0)).toBe("0m");
    expect(formatDistanceMeters(999.6)).toBe("1000m");
  });

  it("1000mちょうどは小数なしのkm表示にする", () => {
    expect(formatDistanceMeters(1000)).toBe("1km");
    expect(formatDistanceMeters(3000)).toBe("3km");
  });

  it("1000m超は小数第1位までのkm表示にする", () => {
    expect(formatDistanceMeters(1200)).toBe("1.2km");
    expect(formatDistanceMeters(1850)).toBe("1.9km");
  });
});
