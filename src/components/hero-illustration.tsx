/** Isometric building-model illustration for the landing hero (pure SVG, decorative). */
export function HeroIllustration() {
  const win = (x: number, y: number, key: string) => <rect key={key} x={x} y={y} width="7" height="10" rx="1.5" fill="white" opacity=".55" transform="skewY(-26)" />;
  return (
    <svg viewBox="0 0 520 460" className="h-auto w-full" role="img" aria-label="Isometric BIM model of a tower with surrounding blocks">
      <defs>
        <linearGradient id="hl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fb0ff" /><stop offset="1" stopColor="#6d8df0" /></linearGradient>
        <linearGradient id="hr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b7be8" /><stop offset="1" stopColor="#3f58c9" /></linearGradient>
        <linearGradient id="ht" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#dfe7ff" /><stop offset="1" stopColor="#b9c9ff" /></linearGradient>
        <linearGradient id="vl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b9a6ff" /><stop offset="1" stopColor="#8d74f2" /></linearGradient>
        <linearGradient id="vr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8d74f2" /><stop offset="1" stopColor="#6a4fe0" /></linearGradient>
      </defs>
      {/* platform */}
      <polygon points="260,300 500,370 260,440 20,370" fill="#e9eefc" />
      <polygon points="260,312 470,372 260,432 50,372" fill="#f6f8ff" stroke="#d9e1fa" />
      <g stroke="#d9e1fa" strokeWidth="1" opacity=".9">{[0, 1, 2, 3, 4].map((i) => <line key={i} x1={110 + i * 30} y1={340 + i * 8.5} x2={310 + i * 30} y2={400 + i * 8.5} />)}</g>
      {/* low block (violet) */}
      <polygon points="150,345 200,330 250,345 200,360" fill="#cdbfff" />
      <polygon points="150,345 200,360 200,395 150,380" fill="url(#vl)" />
      <polygon points="200,360 250,345 250,380 200,395" fill="url(#vr)" />
      {/* main tower */}
      <polygon points="215,120 290,100 365,120 290,140" fill="url(#ht)" />
      <polygon points="215,120 290,140 290,372 215,352" fill="url(#hl)" />
      <polygon points="290,140 365,120 365,332 290,372" fill="url(#hr)" />
      <g transform="translate(215 140)">{[0, 1, 2, 3, 4, 5, 6, 7].flatMap((r) => [0, 1, 2].map((c) => win(10 + c * 22, 22 + r * 26 + c * 8 + 0, `l${r}${c}`)))}</g>
      <g transform="translate(290 140)" opacity=".8">{[0, 1, 2, 3, 4, 5, 6, 7].flatMap((r) => [0, 1, 2].map((c) => <rect key={`r${r}${c}`} x={10 + c * 22} y={46 + r * 26 - c * 8} width="7" height="10" rx="1.5" fill="white" opacity=".4" transform="skewY(26)" />))}</g>
      {/* side tower */}
      <polygon points="330,250 375,238 420,250 375,262" fill="url(#ht)" />
      <polygon points="330,250 375,262 375,356 330,344" fill="url(#hl)" />
      <polygon points="375,262 420,250 420,338 375,356" fill="url(#hr)" />
      {/* rooftop accent */}
      <polygon points="268,112 290,106 312,112 290,118" fill="#7c5cf0" opacity=".9" />
    </svg>
  );
}
