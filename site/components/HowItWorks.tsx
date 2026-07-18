export function HowItWorks() {
  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-6">how it works</h2>
      <p className="text-muted text-sm leading-relaxed text-justify mb-6">
        you push code. pux detects it, polls GitHub Actions until the run
        finishes. if it fails, pux pulls the logs, extracts the stacktrace,
        grabs your diff and changed files, and writes everything into a single
        markdown file at <span className="text-accent">.ai-context/failure.md</span>.
      </p>
      <p className="text-muted text-sm leading-relaxed text-justify mb-6">
        your AI agent — claude, codex, cursor, copilot, whoever — picks it up
        on the next prompt. no tabs, no scrolling, no manual copy-paste. the
        context is already there.
      </p>
      <p className="text-foreground text-sm leading-relaxed text-justify">
        git push → pux watches → build fails → context written. that&apos;s it.
      </p>
    </section>
  );
}
