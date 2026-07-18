export function HowItWorks() {
  const steps = [
    {
      label: "git push",
      description: "you push code to your repo",
      icon: "→",
    },
    {
      label: "pux watches",
      description: "monitors GitHub Actions in real time",
      icon: "◌",
    },
    {
      label: "build fails",
      description: "downloads logs, extracts the signal",
      icon: "✗",
    },
    {
      label: "context ready",
      description: "writes .ai-context/failure.md",
      icon: "✓",
    },
  ];

  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-10">how it works</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {steps.map((step, i) => (
          <div
            key={i}
            className="bg-[#111111] border border-[#2a2a2a] rounded-lg p-4 text-center"
          >
            <div className="text-2xl mb-2 text-accent">{step.icon}</div>
            <p className="text-foreground text-sm font-bold mb-1">
              {step.label}
            </p>
            <p className="text-muted text-xs">{step.description}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 bg-[#111111] border border-[#2a2a2a] rounded-lg p-5 w-full text-xs sm:text-sm">
        <pre className="text-muted leading-relaxed">
          {`Git Push
  ↓
Git Monitor (detects push)
  ↓
GitHub Watcher (polls Actions API)
  ↓
Log Collector (downloads failed step logs)
  ↓
Error Parser (extracts relevant stacktrace)
  ↓
Context Generator (assembles AI-ready report)
  ↓
`}
          <span className="text-accent">
            .ai-context/failure.md written
          </span>
        </pre>
      </div>
    </section>
  );
}
