import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/firebase/admin", () => ({ adminAuth: {} }));

const { maskIp, deviceFromUserAgent } = await import("./service");

describe("maskIp", () => {
  it("keeps only the network part", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.x");
    expect(maskIp("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
  });
  it("handles missing or odd values", () => {
    expect(maskIp(null)).toBe("—");
    expect(maskIp("unknown")).toBe("—");
    expect(maskIp("not-an-ip")).toBe("—");
  });
});

describe("deviceFromUserAgent", () => {
  it("gives a short label, not a fingerprint", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceFromUserAgent(null)).toBe("—");
  });
});
