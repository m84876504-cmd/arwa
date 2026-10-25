"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ----------------------------- Types & constants ----------------------------- */

type Kind =
  | "num"
  | "op"
  | "fn"
  | "const"
  | "lp"
  | "rp"
  | "post"
  | "sign"
  | "del"
  | "clear"
  | "equals";

interface Btn {
  id: string;
  label: string;
  kind: Kind;
  value: string;
  aria: string;
}

interface HistoryItem {
  id: string;
  expr: string;
  result: string;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "const"; v: number }
  | { t: "op"; v: string }
  | { t: "post"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" }
  | { t: "rp" };

const OPS = "+−×÷^";
const FN_TOKENS = ["sin(", "cos(", "tan(", "log(", "ln(", "√("];
const MAX_LEN = 120;

const mk = (kind: Kind, value: string, label?: string, aria?: string): Btn => ({
  id: `${kind}:${value}`,
  label: label ?? value,
  kind,
  value,
  aria: aria ?? label ?? value,
});

const MAIN_KEYS: Btn[] = [
  mk("clear", "AC", "AC", "All clear"),
  mk("del", "⌫", "⌫", "Delete"),
  mk("post", "%", "%", "Percent"),
  mk("op", "÷", "÷", "Divide"),
  mk("num", "7"),
  mk("num", "8"),
  mk("num", "9"),
  mk("op", "×", "×", "Multiply"),
  mk("num", "4"),
  mk("num", "5"),
  mk("num", "6"),
  mk("op", "−", "−", "Subtract"),
  mk("num", "1"),
  mk("num", "2"),
  mk("num", "3"),
  mk("op", "+", "+", "Add"),
  mk("sign", "±", "±", "Toggle sign"),
  mk("num", "0"),
  mk("num", ".", ".", "Decimal point"),
  mk("equals", "=", "=", "Equals"),
];

const SCI_ROW_1: Btn[] = [
  mk("fn", "sin(", "sin", "Sine"),
  mk("fn", "cos(", "cos", "Cosine"),
  mk("fn", "tan(", "tan", "Tangent"),
  mk("const", "π", "π", "Pi"),
];
const SCI_ROW_2: Btn[] = [
  mk("fn", "ln(", "ln", "Natural log"),
  mk("fn", "log(", "log", "Log base 10"),
  mk("fn", "√(", "√", "Square root"),
  mk("post", "^2", "x²", "Square"),
  mk("op", "^", "xʸ", "Power"),
];
const SCI_ROW_3: Btn[] = [
  mk("lp", "(", "(", "Open parenthesis"),
  mk("rp", ")", ")", "Close parenthesis"),
  mk("post", "!", "n!", "Factorial"),
  mk("const", "e", "e", "Euler's number"),
  mk("fn", "1÷(", "1/x", "Reciprocal"),
];

/* ------------------------------ Safe evaluation ------------------------------ */

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const opMap: Record<string, string> = { "-": "−", "*": "×", "/": "÷" };
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1 || raw === ".") {
        throw new Error("Invalid expression");
      }
      out.push({ t: "num", v: parseFloat(raw) });
      i = j;
      continue;
    }
    if ("+−-×÷*/^".includes(c)) {
      out.push({ t: "op", v: opMap[c] ?? c });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === "%" || c === "!") {
      out.push({ t: "post", v: c });
      i++;
      continue;
    }
    if (c === "π") {
      out.push({ t: "const", v: Math.PI });
      i++;
      continue;
    }
    if (c === "e") {
      out.push({ t: "const", v: Math.E });
      i++;
      continue;
    }
    if (c === "√" && src[i + 1] === "(") {
      out.push({ t: "fn", v: "√" });
      i += 2;
      continue;
    }
    let matched = false;
    for (const name of ["sin", "cos", "tan", "log", "ln"]) {
      if (src.startsWith(name + "(", i)) {
        out.push({ t: "fn", v: name });
        i += name.length + 1;
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error("Invalid expression");
  }
  return out;
}

function isOp(
  t: Tok | undefined,
  ...vs: string[]
): t is Extract<Tok, { t: "op" }> {
  return !!t && t.t === "op" && vs.includes(t.v);
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) {
    throw new Error("Invalid input");
  }
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Recursive-descent parser: no eval(), no Function(). */
function evaluate(src: string, deg: boolean): number {
  const toks = tokenize(src);
  if (!toks.length) throw new Error("Invalid expression");
  let p = 0;

  const peek = (): Tok | undefined => toks[p];
  const toRad = (x: number) => (deg ? (x * Math.PI) / 180 : x);
  const clean = (x: number) => (Math.abs(x) < 1e-14 ? 0 : x);

  function closeParen() {
    const n = peek();
    if (n && n.t === "rp") {
      p++;
      return;
    }
    if (n === undefined) return; // auto-close at end
    throw new Error("Invalid expression");
  }

  function applyFn(name: string, v: number): number {
    switch (name) {
      case "sin":
        return clean(Math.sin(toRad(v)));
      case "cos":
        return clean(Math.cos(toRad(v)));
      case "tan": {
        const c = Math.cos(toRad(v));
        if (Math.abs(c) < 1e-14) throw new Error("Math error");
        return clean(Math.tan(toRad(v)));
      }
      case "log":
        if (v <= 0) throw new Error("Invalid input");
        return Math.log10(v);
      case "ln":
        if (v <= 0) throw new Error("Invalid input");
        return Math.log(v);
      case "√":
        if (v < 0) throw new Error("Invalid input");
        return Math.sqrt(v);
      default:
        throw new Error("Invalid expression");
    }
  }

  function primary(): number {
    const t = toks[p++];
    if (!t) throw new Error("Incomplete expression");
    switch (t.t) {
      case "num":
      case "const":
        return t.v;
      case "lp": {
        const v = expr();
        closeParen();
        return v;
      }
      case "fn": {
        const v = expr();
        closeParen();
        return applyFn(t.v, v);
      }
      default:
        throw new Error("Invalid expression");
    }
  }

  function postfix(): number {
    let v = primary();
    for (;;) {
      const t = peek();
      if (t && t.t === "post") {
        p++;
        v = t.v === "%" ? v / 100 : factorial(v);
      } else break;
    }
    return v;
  }

  function power(): number {
    const base = postfix();
    const t = peek();
    if (isOp(t, "^")) {
      p++;
      const ex = unary();
      const r = Math.pow(base, ex);
      if (!isFinite(r)) throw new Error("Math error");
      return r;
    }
    return base;
  }

  function unary(): number {
    const t = peek();
    if (isOp(t, "−")) {
      p++;
      return -unary();
    }
    if (isOp(t, "+")) {
      p++;
      return unary();
    }
    return power();
  }

  function term(): number {
    let v = unary();
    for (;;) {
      const t = peek();
      if (isOp(t, "×", "÷")) {
        p++;
        const r = unary();
        if (t.v === "÷") {
          if (r === 0) throw new Error("Cannot divide by zero");
          v /= r;
        } else {
          v *= r;
        }
      } else if (
        t &&
        (t.t === "num" || t.t === "lp" || t.t === "fn" || t.t === "const")
      ) {
        v *= power(); // implicit multiplication
      } else break;
    }
    return v;
  }

  function expr(): number {
    let v = term();
    for (;;) {
      const t = peek();
      if (isOp(t, "+", "−")) {
        p++;
        const r = term();
        v = t.v === "+" ? v + r : v - r;
      } else break;
    }
    return v;
  }

  const result = expr();
  if (p < toks.length) throw new Error("Invalid expression");
  if (!isFinite(result)) throw new Error("Math error");
  return result;
}

function fmt(n: number): string {
  if (!isFinite(n)) throw new Error("Math error");
  if (n === 0 || Object.is(n, -0)) return "0";
  const r = parseFloat(n.toPrecision(12));
  const a = Math.abs(r);
  let s: string;
  if (a >= 1e15 || a < 1e-6) {
    const [m, ex] = r.toExponential(8).split("e");
    const e = parseInt(ex, 10);
    s = `${parseFloat(m)}×10^${e < 0 ? `(−${-e})` : e}`;
  } else {
    s = String(r);
  }
  return s.replace(/-/g, "−");
}

function balance(s: string): string {
  const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  return s + ")".repeat(Math.max(0, open));
}

/* --------------------------------- Styling ---------------------------------- */

function btnClass(
  kind: Kind,
  dark: boolean,
  sci: boolean,
  flash: boolean,
  value: string
): string {
  const base =
    "relative flex items-center justify-center rounded-2xl border font-medium tabular-nums select-none outline-none backdrop-blur-md transition-all duration-150 ease-out hover:-translate-y-px active:scale-95 focus-visible:ring-2 focus-visible:ring-violet-400/80";
  const size = sci
    ? "h-11 text-sm sm:h-12 sm:text-base"
    : "h-14 text-xl sm:h-16 sm:text-2xl";
  let tone: string;
  if (kind === "equals") {
    tone =
      "border-white/20 bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_8px_28px_-4px_rgba(99,102,241,0.7)] hover:shadow-[0_10px_34px_-2px_rgba(139,92,246,0.9)] hover:brightness-110";
  } else if (kind === "clear") {
    tone = dark
      ? "border-rose-300/20 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
      : "border-rose-400/30 bg-rose-500/15 text-rose-700 hover:bg-rose-500/25";
  } else if (sci) {
    tone = dark
      ? "border-white/10 bg-indigo-400/10 text-indigo-100 hover:bg-indigo-400/25"
      : "border-indigo-300/40 bg-indigo-500/10 text-indigo-800 hover:bg-indigo-500/20";
  } else if (kind === "op") {
    tone = dark
      ? "border-violet-300/20 bg-violet-500/25 text-violet-100 shadow-[0_0_18px_-6px_rgba(139,92,246,0.8)] hover:bg-violet-500/40"
      : "border-violet-400/30 bg-violet-500/15 text-violet-700 hover:bg-violet-500/25";
  } else if (kind === "num") {
    tone = dark
      ? "border-white/10 bg-white/10 text-white hover:bg-white/20"
      : "border-white/80 bg-white/70 text-slate-800 shadow-sm hover:bg-white";
  } else {
    tone = dark
      ? "border-sky-300/20 bg-sky-400/15 text-sky-100 hover:bg-sky-400/30"
      : "border-sky-400/30 bg-sky-500/15 text-sky-800 hover:bg-sky-500/25";
  }
  const shadow = dark ? "shadow-lg shadow-black/20" : "";
  const flashCls = flash
    ? "scale-95 brightness-125 ring-2 ring-violet-300/70"
    : "";
  void value;
  return `${base} ${size} ${tone} ${shadow} ${flashCls}`;
}

/* ------------------------------- Small icons -------------------------------- */

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const MoonIcon = () => (
  <Icon>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Icon>
);
const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </Icon>
);

/* ---------------------------------- Page ------------------------------------ */

export default function Page() {
  const [expr, setExpr] = useState("");
  const [lastExpr, setLastExpr] = useState("");
  const [evaluated, setEvaluated] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sci, setSci] = useState(false);
  const [dark, setDark] = useState(true);
  const [deg, setDeg] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const loaded = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayRef = useRef<HTMLDivElement>(null);

  /* Load persisted settings */
  useEffect(() => {
    try {
      const th = localStorage.getItem("glasscalc-theme");
      if (th === "light") setDark(false);
      const raw = localStorage.getItem("glasscalc-history");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const safe = parsed
            .filter(
              (h): h is HistoryItem =>
                !!h &&
                typeof h.id === "string" &&
                typeof h.expr === "string" &&
                typeof h.result === "string"
            )
            .slice(0, 50);
          setHistory(safe);
        }
      }
    } catch {
      /* storage unavailable */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem("glasscalc-theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem("glasscalc-history", JSON.stringify(history));
    } catch {
      /* ignore */
    }
  }, [history]);

  /* Keep the latest characters visible */
  useEffect(() => {
    const el = displayRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [expr, error]);

  /* Live preview of the result */
  const preview = useMemo(() => {
    if (!expr || evaluated) return "";
    try {
      if (tokenize(expr).length < 2) return "";
      const r = fmt(evaluate(balance(expr), deg));
      return r === expr ? "" : r;
    } catch {
      return "";
    }
  }, [expr, evaluated, deg]);

  /* Core input handler */
  const press = (kind: Kind, value: string) => {
    if (error) setError("");
    let cur = expr;
    let ev = evaluated;

    switch (kind) {
      case "clear":
        setExpr("");
        setLastExpr("");
        setEvaluated(false);
        setError("");
        return;

      case "del": {
        if (error) return;
        ev = false;
        const fn = FN_TOKENS.find((f) => cur.endsWith(f));
        cur = fn ? cur.slice(0, -fn.length) : cur.slice(0, -1);
        break;
      }

      case "num": {
        if (ev) {
          cur = "";
          ev = false;
        }
        const prevMul = /[)πe%!]$/.test(cur);
        const seg = cur.match(/[0-9.]*$/)![0];
        if (value === ".") {
          if (seg.includes(".")) return;
          if (seg === "") {
            if (prevMul) cur += "×";
            cur += "0.";
          } else {
            cur += ".";
          }
        } else {
          if (prevMul) cur += "×";
          if (seg === "0" && !prevMul) cur = cur.slice(0, -1) + value;
          else cur += value;
        }
        break;
      }

      case "op": {
        ev = false;
        if (cur === "") {
          if (value !== "−") return;
          cur = "−";
          break;
        }
        const last = cur.slice(-1);
        if (last === "(") {
          if (value !== "−") return;
          cur += "−";
          break;
        }
        if (OPS.includes(last)) {
          if (value === "−" && "×÷^".includes(last)) {
            cur += "−";
            break;
          }
          const stripped = cur.replace(/[+−×÷^]+$/, "");
          if (stripped === "") {
            cur = value === "−" ? "−" : cur;
            break;
          }
          if (stripped.endsWith("(") && value !== "−") return;
          cur = stripped + value;
          break;
        }
        cur += value;
        break;
      }

      case "fn":
      case "const":
      case "lp": {
        if (ev) {
          cur = "";
          ev = false;
        }
        if (/[0-9)πe%!]$/.test(cur)) cur += "×";
        cur += value;
        break;
      }

      case "rp": {
        const open =
          (cur.match(/\(/g) || []).length - (cur.match(/\)/g) || []).length;
        if (open <= 0) return;
        if (/[+−×÷^(]$/.test(cur)) return;
        cur += ")";
        break;
      }

      case "post": {
        ev = false;
        if (!/[0-9)πe%!]$/.test(cur)) return;
        cur += value;
        break;
      }

      case "sign": {
        ev = false;
        const neg = cur.match(/\(−([0-9]*\.?[0-9]+|[0-9]+\.)\)$/);
        const lead = cur.match(/^−([0-9]*\.?[0-9]+|[0-9]+\.)$/);
        if (neg && neg.index !== undefined) {
          cur = cur.slice(0, neg.index) + neg[1];
        } else if (lead) {
          cur = lead[1];
        } else {
          const m = cur.match(/([0-9]*\.?[0-9]+|[0-9]+\.)$/);
          if (!m || m.index === undefined) return;
          cur = cur.slice(0, m.index) + "(−" + m[1] + ")";
        }
        break;
      }

      case "equals": {
        if (cur === "" || ev) return;
        try {
          const closed = balance(cur);
          const res = fmt(evaluate(closed, deg));
          setHistory((h) =>
            [
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                expr: closed,
                result: res,
              },
              ...h,
            ].slice(0, 50)
          );
          setLastExpr(closed);
          setExpr(res);
          setEvaluated(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error");
        }
        return;
      }
    }

    if (cur.length > MAX_LEN) return;
    setExpr(cur);
    setEvaluated(ev);
  };

  const trigger = (kind: Kind, value: string) => {
    press(kind, value);
    setFlash(`${kind}:${value}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 140);
  };

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  /* Keyboard support */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      const k = e.key;
      if (
        target &&
        target.tagName === "BUTTON" &&
        (k === "Enter" || k === " ")
      ) {
        return; // let a focused button activate natively
      }
      let action: [Kind, string] | null = null;
      if (/^[0-9]$/.test(k)) action = ["num", k];
      else if (k === "." || k === ",") action = ["num", "."];
      else if (k === "+") action = ["op", "+"];
      else if (k === "-") action = ["op", "−"];
      else if (k === "*" || k === "x" || k === "X") action = ["op", "×"];
      else if (k === "/") action = ["op", "÷"];
      else if (k === "^") action = ["op", "^"];
      else if (k === "(") action = ["lp", "("];
      else if (k === ")") action = ["rp", ")"];
      else if (k === "%") action = ["post", "%"];
      else if (k === "!") action = ["post", "!"];
      else if (k === "Enter" || k === "=") action = ["equals", "="];
      else if (k === "Backspace") action = ["del", "⌫"];
      else if (k === "Escape" || k === "Delete") action = ["clear", "AC"];
      if (action) {
        e.preventDefault();
        triggerRef.current(action[0], action[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadHistory = useCallback((h: HistoryItem) => {
    setExpr(h.result);
    setLastExpr(h.expr);
    setEvaluated(true);
    setError("");
  }, []);

  /* Theme tokens */
  const t = dark
    ? {
        page: "text-white",
        bg: "bg-gradient-to-br from-[#2b0f63] via-[#17104d] to-[#071333]",
        card: "border-white/15 bg-white/[0.07]",
        panel: "border-white/10 bg-black/25",
        muted: "text-white/55",
        icon: "bg-white/10 text-white/90 hover:bg-white/20",
        item: "hover:bg-white/10",
        divider: "border-white/10",
        glow: "shadow-[0_24px_90px_-12px_rgba(99,102,241,0.55)]",
      }
    : {
        page: "text-slate-800",
        bg: "bg-gradient-to-br from-[#ece6ff] via-[#dde6ff] to-[#cfe8ff]",
        card: "border-white/70 bg-white/45",
        panel: "border-white/80 bg-white/55",
        muted: "text-slate-500",
        icon: "bg-white/60 text-slate-700 hover:bg-white/90",
        item: "hover:bg-white/70",
        divider: "border-slate-300/50",
        glow: "shadow-[0_24px_80px_-16px_rgba(99,102,241,0.35)]",
      };

  const widthCls = sci ? "max-w-[520px]" : "max-w-[400px]";
  const bigLen = (error || expr || "0").length;
  const bigSize =
    error
      ? "text-2xl sm:text-3xl"
      : bigLen > 18
      ? "text-2xl sm:text-3xl"
      : bigLen > 12
      ? "text-3xl sm:text-4xl"
      : "text-4xl sm:text-5xl";

  const renderKey = (b: Btn, sciKey = false) => (
    <button
      key={b.id}
      type="button"
      aria-label={b.aria}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => press(b.kind, b.value)}
      className={btnClass(b.kind, dark, sciKey, flash === b.id, b.value)}
    >
      {b.label}
    </button>
  );

  return (
    <main
      className={`relative min-h-[100dvh] w-full transition-colors duration-500 ${t.bg} ${t.page}`}
    >
      <style>{`
        @keyframes gc-float-a { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(40px,30px,0) scale(1.1); } }
        @keyframes gc-float-b { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(-50px,-35px,0) scale(1.15); } }
        @keyframes gc-float-c { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(30px,-40px,0) scale(0.9); } }
        .gc-a { animation: gc-float-a 16s ease-in-out infinite; }
        .gc-b { animation: gc-float-b 20s ease-in-out infinite; }
        .gc-c { animation: gc-float-c 18s ease-in-out infinite; }
        .gc-noscroll { scrollbar-width: none; }
        .gc-noscroll::-webkit-scrollbar { display: none; }
        .gc-thin { scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.5) transparent; }
        @media (prefers-reduced-motion: reduce) {
          .gc-a, .gc-b, .gc-c { animation: none; }
        }
      `}</style>

      {/* Blurred background shapes */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={`gc-a absolute -left-24 -top-32 h-[26rem] w-[26rem] rounded-full blur-3xl ${
            dark ? "bg-violet-600/40" : "bg-violet-400/40"
          }`}
        />
        <div
          className={`gc-b absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full blur-3xl ${
            dark ? "bg-blue-500/35" : "bg-sky-400/40"
          }`}
        />
        <div
          className={`gc-c absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl ${
            dark ? "bg-fuchsia-500/20" : "bg-fuchsia-300/30"
          }`}
        />
        <div
          className={`gc-a absolute bottom-10 left-6 h-40 w-40 rounded-full blur-2xl ${
            dark ? "bg-indigo-400/25" : "bg-indigo-300/40"
          }`}
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] w-full items-center justify-center p-3 sm:p-6">
        <div className="flex w-full flex-col items-center justify-center gap-4 lg:flex-row lg:items-stretch">
          {/* Calculator */}
          <section
            className={`w-full transition-all duration-500 ${widthCls}`}
            aria-label="Calculator"
          >
            <div
              className={`rounded-[28px] bg-gradient-to-br from-white/40 via-white/5 to-violet-400/40 p-px ${t.glow}`}
            >
              <div
                className={`rounded-[27px] border p-3 backdrop-blur-2xl sm:p-5 ${t.card}`}
              >
                {/* Header */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.9)]" />
                    <span className="text-sm font-semibold tracking-wide">
                      Glass Calc
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Toggle history"
                      aria-pressed={showHistory}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowHistory((s) => !s)}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 active:scale-95 lg:hidden ${
                        showHistory
                          ? "bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_0_16px_rgba(124,92,255,0.6)]"
                          : t.icon
                      }`}
                    >
                      <ClockIcon />
                    </button>
                    <button
                      type="button"
                      aria-label="Toggle scientific mode"
                      aria-pressed={sci}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSci((s) => !s)}
                      className={`flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-sm font-semibold italic transition-all duration-200 active:scale-95 ${
                        sci
                          ? "bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-[0_0_16px_rgba(124,92,255,0.6)]"
                          : t.icon
                      }`}
                    >
                      fx
                    </button>
                    <button
                      type="button"
                      aria-label={
                        dark ? "Switch to light theme" : "Switch to dark theme"
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDark((d) => !d)}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 active:scale-95 ${t.icon}`}
                    >
                      {dark ? <SunIcon /> : <MoonIcon />}
                    </button>
                  </div>
                </div>

                {/* Display */}
                <div
                  className={`mb-3 rounded-2xl border px-4 py-3 shadow-inner backdrop-blur-md sm:mb-4 sm:py-4 ${t.panel}`}
                >
                  <div
                    className={`gc-noscroll h-5 overflow-x-auto whitespace-nowrap text-right text-sm tabular-nums ${t.muted}`}
                  >
                    {evaluated
                      ? `${lastExpr} =`
                      : preview
                      ? `= ${preview}`
                      : "\u00a0"}
                  </div>
                  <div
                    ref={displayRef}
                    aria-live="polite"
                    className={`gc-noscroll mt-1 overflow-x-auto whitespace-nowrap text-right font-semibold tabular-nums leading-tight transition-[font-size] duration-200 ${bigSize} ${
                      error ? "text-rose-400" : ""
                    }`}
                  >
                    {error || expr || "0"}
                  </div>
                  {error && (
                    <div
                      className={`gc-noscroll mt-1 overflow-x-auto whitespace-nowrap text-right text-xs tabular-nums ${t.muted}`}
                    >
                      {expr}
                    </div>
                  )}
                </div>

                {/* Scientific panel */}
                <div
                  className={`overflow-hidden transition-all duration-500 ease-out ${
                    sci
                      ? "visible mb-2 max-h-60 opacity-100 sm:mb-3"
                      : "invisible mb-0 max-h-0 opacity-0"
                  }`}
                  aria-hidden={!sci}
                >
                  <div className="grid grid-cols-5 gap-2">
                    <button
                      type="button"
                      aria-label="Toggle degrees and radians"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setDeg((d) => !d)}
                      className={`flex h-11 items-center justify-center rounded-2xl border text-xs font-semibold tracking-wider outline-none backdrop-blur-md transition-all duration-150 hover:-translate-y-px active:scale-95 focus-visible:ring-2 focus-visible:ring-violet-400/80 sm:h-12 sm:text-sm ${
                        dark
                          ? "border-blue-300/30 bg-blue-500/25 text-blue-100 hover:bg-blue-500/40"
                          : "border-blue-400/40 bg-blue-500/15 text-blue-800 hover:bg-blue-500/25"
                      }`}
                    >
                      {deg ? "DEG" : "RAD"}
                    </button>
                    {SCI_ROW_1.map((b) => renderKey(b, true))}
                    {SCI_ROW_2.map((b) => renderKey(b, true))}
                    {SCI_ROW_3.map((b) => renderKey(b, true))}
                  </div>
                </div>

                {/* Main keypad */}
                <div className="grid grid-cols-4 gap-2 sm:gap-3">
                  {MAIN_KEYS.map((b) => renderKey(b))}
                </div>

                <p
                  className={`mt-3 hidden text-center text-[11px] sm:block ${t.muted}`}
                >
                  Keyboard: 0-9 + − * / ^ ( ) % ! · Enter = · Backspace · Esc
                </p>
              </div>
            </div>
          </section>

          {/* History */}
          <aside
            className={`relative w-full lg:w-72 lg:max-w-none ${widthCls} ${
              showHistory ? "block" : "hidden"
            } lg:block`}
            aria-label="Calculation history"
          >
            <div
              className={`flex h-full max-h-72 flex-col rounded-[24px] border p-4 backdrop-blur-2xl lg:absolute lg:inset-0 lg:max-h-none ${t.card} ${t.glow}`}
            >
              <div
                className={`mb-2 flex items-center justify-between border-b pb-2 ${t.divider}`}
              >
                <h2 className="text-sm font-semibold tracking-wide">History</h2>
                <button
                  type="button"
                  aria-label="Clear history"
                  disabled={history.length === 0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setHistory([])}
                  className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${t.icon}`}
                >
                  <TrashIcon />
                  Clear
                </button>
              </div>
              {history.length === 0 ? (
                <div
                  className={`flex flex-1 items-center justify-center text-sm ${t.muted}`}
                >
                  No calculations yet
                </div>
              ) : (
                <ul className="gc-thin -mr-2 flex-1 space-y-1 overflow-y-auto pr-2">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => loadHistory(h)}
                        title="Use this result"
                        className={`w-full rounded-xl px-3 py-2 text-right transition-all duration-150 active:scale-[0.98] ${t.item}`}
                      >
                        <div
                          className={`gc-noscroll overflow-x-auto whitespace-nowrap text-xs tabular-nums ${t.muted}`}
                        >
                          {h.expr} =
                        </div>
                        <div className="gc-noscroll overflow-x-auto whitespace-nowrap text-lg font-semibold tabular-nums">
                          {h.result}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}