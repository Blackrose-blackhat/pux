"use client";

import { useEffect, useState } from "react";

const catFrames = [
  [" /\\_/\\  ", "( ^.^ ) ", " > ^ <  "],
  [" /\\_/\\  ", "( ^.^ )~", " > ^ <  "],
  [" /\\_/\\  ", "( o.o ) ", " > ^ <  "],
  [" /\\_/\\  ", "( o.o )~", " > ^ <  "],
];

const lines = [
  { type: "status", icon: "✓", color: "success", text: "Repository: user/my-app" },
  { type: "status", icon: "✓", color: "success", text: "Workflow: CI", dim: "#12847" },
  { type: "status", icon: "◌", color: "yellow", text: "Running" },
  { type: "spacer" },
  { type: "progress" },
  { type: "job", icon: "✓", color: "success", text: "lint" },
  { type: "job", icon: "✓", color: "success", text: "typecheck" },
  { type: "job", icon: "✓", color: "success", text: "unit-tests" },
  { type: "job", icon: "✓", color: "success", text: "build" },
  { type: "job", icon: "◌", color: "yellow", text: "deploy", dim: "· 3/5 steps" },
  { type: "step", text: "↳ Run deployment script" },
  { type: "job", icon: "·", color: "muted", text: "e2e-tests" },
] as const;

export function Terminal() {
  const [catFrame, setCatFrame] = useState(0);
  const [visibleLines, setVisibleLines] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCatFrame((f) => (f + 1) % catFrames.length);
    }, 700);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (visibleLines < lines.length) {
      const timer = setTimeout(
        () => setVisibleLines((v) => v + 1),
        visibleLines === 0 ? 600 : 150 + Math.random() * 100
      );
      return () => clearTimeout(timer);
    }
  }, [visibleLines]);

  useEffect(() => {
    if (visibleLines >= 5 && progressWidth < 8) {
      const timer = setTimeout(() => setProgressWidth((w) => w + 1), 200);
      return () => clearTimeout(timer);
    }
  }, [visibleLines, progressWidth]);

  const cat = catFrames[catFrame];

  return (
    <section className="flex justify-center px-4 pb-16">
      <div className="w-full max-w-2xl bg-[#111111] border border-[#2a2a2a] rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2a2a]">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-muted text-xs ml-2">pux watch</span>
        </div>
        <div className="p-4 text-xs sm:text-sm leading-relaxed font-mono">
          <div className="flex gap-2 mb-4">
            <pre className="text-accent leading-tight text-xs sm:text-sm">
              {cat[0]}
              {"\n"}
              {cat[1]}
              {"\n"}
              {cat[2]}
            </pre>
            <div className="flex flex-col justify-center">
              <span className="text-accent font-bold">pux</span>
              <span className="text-muted text-xs">
                CI context, ready for your AI
              </span>
            </div>
          </div>

          <div className="space-y-1 min-h-[220px]">
            {lines.slice(0, visibleLines).map((line, i) => {
              if (line.type === "spacer") return <div key={i} className="h-2" />;

              if (line.type === "progress") {
                const filled = "█".repeat(progressWidth);
                const empty = "░".repeat(12 - progressWidth);
                return (
                  <p key={i}>
                    <span className="text-foreground">Progress </span>
                    <span className="text-accent">{filled}</span>
                    <span className="text-muted">{empty}</span>
                    <span className="text-foreground">
                      {" "}
                      {progressWidth}/8 jobs
                    </span>
                  </p>
                );
              }

              if (line.type === "step") {
                return (
                  <p key={i} className="text-muted pl-4">
                    {line.text}
                  </p>
                );
              }

              const colorClass =
                line.color === "success"
                  ? "text-success"
                  : line.color === "yellow"
                  ? "text-[#eab308]"
                  : "text-muted";

              return (
                <p key={i} className="animate-[fadeIn_0.3s_ease-in]">
                  <span className={colorClass}>{line.icon}</span>{" "}
                  <span
                    className={
                      line.type === "job" ? "text-muted" : "text-foreground"
                    }
                  >
                    {line.text}
                  </span>
                  {"dim" in line && line.dim && (
                    <span className="text-muted"> {line.dim}</span>
                  )}
                </p>
              );
            })}
          </div>

          <p className="mt-4 text-muted">
            Refreshes every 3s · press q to quit
          </p>
        </div>
      </div>
    </section>
  );
}
