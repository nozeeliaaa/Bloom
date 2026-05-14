import { vi } from "vitest";

export const mockSave = vi.fn();

export class jsPDF {
  constructor() {
    this.pages = [1];
    this.lastAutoTable = { finalY: 40 };
  }
  setLineWidth() {}
  setTextColor() {}
  setFillColor() {}
  setDrawColor() {}
  line() {}
  rect() {}
  roundedRect() {}
  circle() {}
  setFont() {}
  setFontSize() {}
  text() {}
  splitTextToSize(text) { return [String(text)]; }
  addPage() { this.pages.push(this.pages.length + 1); }
  getNumberOfPages() { return this.pages.length; }
  setPage() {}
  save(...args) { mockSave(...args); }
}
