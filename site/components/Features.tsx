export function Features() {
  const features = [
    {
      title: "real-time CI monitoring",
      description:
        "watches GitHub Actions runs with live job and step progress. animated progress bar, per-job status.",
    },
    {
      title: "multi-provider support",
      description:
        "monitors GitHub Actions and Vercel deployments side by side. auto-detects monorepos and watches all pipelines from a single view.",
    },
    {
      title: "automatic failure context",
      description:
        "when CI fails, downloads logs, extracts the relevant error window, collects diff and config files.",
    },
    {
      title: "AI agent integration",
      description:
        "auto-injects context pointers into CLAUDE.md, AGENTS.md, .cursorrules, and 6 other agent files.",
    },
    {
      title: "adaptive live polling",
      description:
        "detects pushes and new commits automatically. polls every 3s during active builds, backs off when idle.",
    },
    {
      title: "ambient companion",
      description:
        "a small cat lives in your terminal. watches your builds. reacts to success and failure. never interrupts.",
    },
  ];

  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-10">features</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        {features.map((f, i) => (
          <div
            key={i}
            className="bg-[#111111] border border-[#2a2a2a] rounded-lg p-5"
          >
            <p className="text-foreground text-sm font-bold mb-2">{f.title}</p>
            <p className="text-muted text-xs leading-relaxed">
              {f.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
