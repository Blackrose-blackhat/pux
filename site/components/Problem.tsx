export function Problem() {
  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-6">the problem</h2>
      <p className="text-muted text-sm leading-relaxed text-justify mb-6">
        every CI failure today is the same ritual. open GitHub, find the run,
        scroll through 8000 lines of logs, copy the error, paste it into your
        AI, get asked for more context, copy the diff, paste again, repeat.
      </p>
      <p className="text-muted text-sm leading-relaxed text-justify mb-6">
        by the time you have enough context pasted in, you&apos;ve lost 25 minutes
        and opened 7 tabs. the fix was probably one line.
      </p>
      <p className="text-foreground text-sm leading-relaxed text-justify">
        pux removes this entire loop. push your code, let the cat watch.
        when CI fails, your AI already has the full picture — logs, diff,
        config, everything — zero tabs, zero copy-paste.
      </p>
    </section>
  );
}
