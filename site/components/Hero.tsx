"use client";

import { useState } from "react";

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText("npm install -g pux.sh");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="flex flex-col items-center justify-center pt-24 pb-16 px-4">
      <pre className="text-accent text-sm sm:text-base leading-tight mb-6">
        {` /\\_/\\
( o.o )~
 > ^ <`}
      </pre>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
        pux.sh
      </h1>
      <p className="text-muted text-center max-w-md text-sm sm:text-base mb-8">
        pux tells you why your build failed before you open GitHub.
      </p>
      <div
        onClick={copy}
        className="flex items-center gap-3 bg-[#141414] border border-[#2a2a2a] rounded-lg px-4 py-3 cursor-pointer hover:border-accent/50 transition-colors"
      >
        <span className="text-muted">$</span>
        <code className="text-foreground text-sm">npm install -g pux.sh</code>
        <span className="text-muted text-xs ml-2">
          {copied ? "copied!" : "click to copy"}
        </span>
      </div>
    </section>
  );
}
