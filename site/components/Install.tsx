"use client";

import { useState } from "react";

function CopyBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={copy}
      className="flex items-center gap-3 bg-[#111111] border border-[#2a2a2a] rounded-lg px-4 py-3 cursor-pointer hover:border-accent/50 transition-colors"
    >
      <span className="text-muted">$</span>
      <code className="text-foreground text-sm flex-1">{command}</code>
      <span className="text-muted text-xs">
        {copied ? "copied!" : "copy"}
      </span>
    </div>
  );
}

export function Install() {
  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-8">get started</h2>
      <div className="space-y-3 w-full">
        <p className="text-muted text-xs uppercase tracking-wide">npm</p>
        <CopyBlock command="npm install -g pux.sh" />
        <p className="text-muted text-xs uppercase tracking-wide mt-4">homebrew</p>
        <CopyBlock command="brew install Blackrose-blackhat/pux/pux" />
      </div>
      <div className="space-y-3 w-full mt-8">
        <p className="text-muted text-xs uppercase tracking-wide">then run</p>
        <CopyBlock command="pux watch" />
        <CopyBlock command="pux doctor" />
      </div>
      <p className="text-muted text-xs mt-6 text-center">
        requires Node.js 22+ and{" "}
        <a
          href="https://cli.github.com/"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub CLI
        </a>{" "}
        authenticated. Vercel CLI optional for deployment monitoring.
      </p>
    </section>
  );
}
