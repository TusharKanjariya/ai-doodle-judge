import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [preview, setPreview] = useState(null);
  const [uploadedBlobURL, setUploadedBlobURL] = useState(null);
  const [mode, setMode] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [eraserOn, setEraserOn] = useState(false);
  // Brush/Eraser size preview
  const cursorRef = useRef(null);
  const cursorMirrorRef = useRef(null);
  const [cursorVisible, setCursorVisible] = useState(false);
  const lastPointerRef = useRef({ x: null, y: null }); // CSS coords inside canvas box
  const erasingRef = useRef(false);
  // Canvas refs
  const canvasRef = useRef(null);
  const brushRef = useRef(8);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);

  function resizeCanvasToDisplaySize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const displayWidth = Math.round(rect.width * dpr);
    const displayHeight = Math.round(rect.height * dpr);
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr); // scale drawing operations back to CSS pixels
      return true;
    }
    return false;
  }

  // Init white canvas
  useEffect(() => {
    const c = canvasRef.current;
    const init = () => {
      resizeCanvasToDisplaySize(c);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      // fill in CSS coords (not device pixels) thanks to ctx.scale
      ctx.fillRect(0, 0, c.getBoundingClientRect().width, c.getBoundingClientRect().height);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = brushRef.current;
    };
    init();
    window.addEventListener("resize", init);
    return () => window.removeEventListener("resize", init);
  }, []);

  // Helpers
  const setArc = (percent) => {
    const circleLength = 2 * Math.PI * 54;
    const offset = circleLength * (1 - Math.max(0, Math.min(1, percent)));
    const el = document.getElementById("arc");
    if (el) {
      el.style.strokeDasharray = circleLength;
      el.style.strokeDashoffset = offset;
    }
  };

  useEffect(() => {
    setArc(result?.score ? result.score / 100 : 0);
  }, [result]);

  const toDataURLBlob = async (dataURL) => {
    const r = await fetch(dataURL);
    return await r.blob();
  };

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (uploadedBlobURL) URL.revokeObjectURL(uploadedBlobURL);
    const url = URL.createObjectURL(file);
    setUploadedBlobURL(url);
    setPreview(url);
  };

  const clearUpload = () => {
    if (uploadedBlobURL) URL.revokeObjectURL(uploadedBlobURL);
    setUploadedBlobURL(null);
    setPreview(null);
  };

  const xy = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - r.left, y: clientY - r.top };
  };


  function stroke(from, to) {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = erasingRef.current ? "#ffffff" : "#000000"; // ← paint white when erasing
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // mirror stroke too (same color/eraser)
    // if (mirrorRef.current) {
    //   const fx = c.width - from.x;
    //   const tx = c.width - to.x;
    //   ctx.beginPath();
    //   ctx.moveTo(fx, from.y);
    //   ctx.lineTo(tx, to.y);
    //   ctx.stroke();
    // }
    ctx.restore();
  }


  const start = (e) => { drawingRef.current = true; lastRef.current = xy(e); };
  const move = (e) => { if (!drawingRef.current) return; const p = xy(e); stroke(lastRef.current, p); lastRef.current = p; };
  const end = () => {
    drawingRef.current = false; lastRef.current = null;
    const c = canvasRef.current;
    setPreview(c.toDataURL("image/png"));
  };

  const clearCanvas = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    setPreview(null);
  };

  const scoreCurrent = async () => {
    setLoading(true);
    setResult(null);
    setArc(0);

    try {
      // Choose image: uploaded > canvas
      let imageBlob;
      if (uploadedBlobURL) {
        const r = await fetch(uploadedBlobURL);
        imageBlob = await r.blob();
      } else {
        const c = canvasRef.current;
        imageBlob = await toDataURLBlob(c.toDataURL("image/png"));
      }

      const form = new FormData();
      form.append("image", imageBlob, "drawing.png"); // field name must be "image"
      form.append("mode", mode);

      const r = await fetch("/api/score", { method: "POST", body: form });
      if (!r.ok) throw new Error(`API ${r.status}`);
      const json = await r.json();
      setResult(json);
    } catch (e) {
      console.error(e);
      setResult({ score: null, label: "—", confidence: null, feedback: "We couldn’t score that. Try again." });
    } finally {
      setLoading(false);
    }
  };
  function updateCursorFromEvent(e) {
    // container is the drawing canvas element
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    lastPointerRef.current = { x, y };
    drawCursorAtCSS(x, y, rect);
  }

  function drawCursorAtCSS(x, y) {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const diameter = Math.max(6, brushRef.current); // brush size = CSS px
    const isErase = erasingRef.current || eraserOn;

    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${x - diameter / 2}px, ${y - diameter / 2}px)`;
    cursor.style.border = `1px solid ${isErase ? "rgba(255,255,255,0.9)" : "rgba(99,102,241,0.9)"}`;
    cursor.style.background = isErase ? "rgba(255,255,255,0.15)" : "transparent";
    cursor.style.opacity = "1";
  }


  function hideCursor() {
    const c = cursorRef.current, m = cursorMirrorRef.current;
    if (c) c.style.opacity = "0";
    if (m) m.style.opacity = "0";
    setCursorVisible(false);
  }

  // When the brush slider changes but the mouse isn't moving, refresh at last position
  function refreshCursorAtLastPos() {
    const { x, y } = lastPointerRef.current;
    if (x == null || y == null) return;
    drawCursorAtCSS(x, y);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 text-slate-100 p-4">
      <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Input */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 backdrop-blur p-4">
          <header className="flex items-center gap-3 mb-3">
            <svg width="26" height="26" viewBox="0 0 24 24"><path fill="currentColor" d="M4 3h16a1 1 0 0 1 1 1v12.5a1 1 0 0 1-.553.894l-7 3.5a1 1 0 0 1-.894 0l-7-3.5A1 1 0 0 1 3 16.5V4a1 1 0 0 1 1-1Zm1 2v10.764L12 19l7-3.236V5H5Z" /></svg>
            <div>
              <h1 className="text-lg font-semibold">Judge My Drawing</h1>
              <p className="text-slate-400 text-sm">Upload an image or doodle below, then hit <b>Score</b>.</p>
            </div>
          </header>

          <div className="grid sm:grid-cols-2 gap-3">
            {/* Upload / Drop */}
            <div>
              <DropZone onFile={handleFile} />
              <div className="text-slate-400 text-sm mt-2">Tip: higher contrast line art works best.</div>
              {uploadedBlobURL && (
                <button onClick={clearUpload} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 hover:border-indigo-400">
                  Clear upload
                </button>
              )}
            </div>

            {/* Drawing pad */}
            <div>
              <div className="flex flex-wrap gap-2 mb-2">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700">
                  Brush
                  <input
                    type="range" min="1" max="32" defaultValue={8}
                    onChange={(e) => {
                      const size = +e.target.value;
                      brushRef.current = size;
                      const ctx = canvasRef.current.getContext("2d");
                      ctx.lineWidth = size;
                      refreshCursorAtLastPos(); // 👈 update preview immediately
                    }}
                  />

                </label>
                <button
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:border-indigo-400"
                  onClick={() => {
                    const next = !eraserOn;
                    setEraserOn(next);
                    erasingRef.current = next;
                    refreshCursorAtLastPos(); // 👈 update ring color/fill
                  }}
                >
                  {eraserOn ? "Eraser (On)" : "Eraser"}
                </button>
                <button className="px-3 py-2 rounded-lg border border-slate-700 hover:border-indigo-400" onClick={clearCanvas}>Clear</button>
              </div>

              <div
                className="relative"
                onMouseEnter={() => setCursorVisible(true)}
                onMouseLeave={hideCursor}
                onMouseMove={updateCursorFromEvent}
                onTouchStart={(e) => { setCursorVisible(true); updateCursorFromEvent(e); }}
                onTouchMove={updateCursorFromEvent}
                onTouchEnd={hideCursor}
              >
                <canvas
                  id="pad"
                  ref={canvasRef}
                  width={800} height={600}
                  className="w-full h-[340px] bg-white rounded-xl border border-slate-700 touch-none select-none"
                  onMouseDown={(e) => { updateCursorFromEvent(e); start(e); }}
                  onMouseMove={(e) => { updateCursorFromEvent(e); move(e); }}
                  onMouseUp={(e) => { updateCursorFromEvent(e); end(); }}
                  onMouseLeave={(e) => { hideCursor(); end(); }}
                  onTouchStart={(e) => { e.preventDefault(); updateCursorFromEvent(e); start(e); }}
                  onTouchMove={(e) => { e.preventDefault(); updateCursorFromEvent(e); move(e); }}
                  onTouchEnd={(e) => { updateCursorFromEvent(e); end(); hideCursor(); }}
                />

                {/* Brush/Eraser preview circle */}
                <div
                  ref={cursorRef}
                  className="absolute pointer-events-none rounded-full"
                  style={{ left: 0, top: 0, opacity: cursorVisible ? 1 : 0, transition: "opacity .08s", zIndex: 10 }}
                />
              </div>

            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <span className="text-slate-400 text-sm">We only process the image to score it. Nothing is stored.</span>
            <div className="flex gap-2">
              <select className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="auto">Auto</option>
                <option value="accuracy">Accuracy</option>
                <option value="style">Style</option>
                <option value="composition">Composition</option>
              </select>
              <button
                onClick={scoreCurrent}
                className="px-4 py-2 rounded-lg border border-slate-700 hover:border-indigo-400 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Scoring…" : "Score"}
              </button>
            </div>
          </div>
        </section>

        {/* Right: Results */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 backdrop-blur p-4 flex flex-col">
          <header className="flex items-center gap-3 mb-3">
            <svg width="26" height="26" viewBox="0 0 24 24"><path fill="currentColor" d="M11 3v10.586l-3.293-3.293L6.293 12.707L12 18.414l5.707-5.707l-1.414-1.414L13 13.586V3h-2Zm-7 16h16v2H4v-2Z" /></svg>
            <div>
              <h2 className="text-base font-semibold">Results</h2>
              <p className="text-slate-400 text-sm">Score, label & feedback</p>
            </div>
          </header>

          {/* Meter */}
          <div className="relative w-44 h-44 mx-auto mb-1">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="12" />
              <circle id="arc" cx="60" cy="60" r="54" fill="none" stroke="url(#g)" strokeWidth="12" strokeLinecap="round"
                strokeDasharray="339.292" strokeDashoffset="339.292" />
              <defs>
                <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 grid place-items-center text-3xl font-extrabold">
              {result?.score == null ? "—" : Math.round(result.score)}
            </div>
          </div>

          <div className="flex justify-center gap-2 mb-3">
            <Badge>Label: {result?.label ?? "—"}</Badge>
            <Badge>Confidence: {result?.confidence == null ? "—" : `${Math.round(result.confidence * 100)}%`}</Badge>
            <Badge>Mode: {mode[0].toUpperCase() + mode.slice(1)}</Badge>
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-slate-700 bg-slate-950 flex-1 grid place-items-center min-h-[220px] mb-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Preview" src={preview} className="max-w-full max-h-[320px]" />
            ) : (
              <span className="text-slate-400">No image yet</span>
            )}
          </div>

          {/* Feedback */}
          <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm leading-6">
            {loading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-slate-700/60 rounded"></div>
                <div className="h-3 bg-slate-700/50 rounded w-2/3"></div>
              </div>
            ) : (
              <p>{result?.feedback ?? "Upload or draw to get AI feedback."}</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

/* ---------- small UI bits ---------- */

function Badge({ children }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full border border-slate-700 bg-slate-950 text-slate-300">
      {children}
    </span>
  );
}

function DropZone({ onFile }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-6 grid place-items-center min-h-[220px] cursor-pointer select-none
        ${drag ? "border-indigo-400 bg-indigo-400/10" : "border-slate-700 bg-slate-900/40"}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      aria-label="Dropzone: drop or select an image"
    >
      <div className="text-center">
        <p className="text-slate-400">Drop your PNG/JPG here</p>
        <div className="mt-2">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 hover:border-indigo-400">
            Choose image
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
