import { vi } from "vitest";

const html2canvas = vi.fn(async () => ({
  toDataURL: vi.fn(() => "data:image/png;base64,mock"),
  width: 800,
  height: 600,
}));

export default html2canvas;
