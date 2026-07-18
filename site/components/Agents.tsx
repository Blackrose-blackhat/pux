export function Agents() {
  const agents = [
    "Claude Code",
    "Codex",
    "Cursor",
    "Copilot",
    "Gemini",
    "Windsurf",
    "Cline",
  ];

  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-3">
        works with your AI
      </h2>
      <p className="text-muted text-sm mb-8 text-center">
        pux auto-connects failure context to whichever agent you use.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {agents.map((agent) => (
          <span
            key={agent}
            className="bg-[#141414] border border-[#2a2a2a] rounded-full px-4 py-2 text-xs text-foreground"
          >
            {agent}
          </span>
        ))}
      </div>
    </section>
  );
}
