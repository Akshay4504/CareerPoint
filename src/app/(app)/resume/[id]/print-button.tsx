"use client";

export function PrintButton() {
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
