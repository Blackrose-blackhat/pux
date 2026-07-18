export function Problem() {
  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-foreground mb-8">the problem</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
        <div className="bg-[#111111] border border-[#2a2a2a] rounded-lg p-5">
          <p className="text-error text-xs uppercase tracking-wider mb-3">
            without pux
          </p>
          <div className="space-y-2 text-sm text-muted">
            <p>open GitHub</p>
            <p className="text-[#333]">↓</p>
            <p>find workflow run</p>
            <p className="text-[#333]">↓</p>
            <p>scroll 8000 log lines</p>
            <p className="text-[#333]">↓</p>
            <p>copy error</p>
            <p className="text-[#333]">↓</p>
            <p>paste into AI</p>
            <p className="text-[#333]">↓</p>
            <p>&quot;need more context&quot;</p>
            <p className="text-[#333]">↓</p>
            <p>copy diff, paste again</p>
            <p className="text-[#333]">↓</p>
            <p>repeat</p>
          </div>
        </div>
        <div className="bg-[#111111] border border-accent/20 rounded-lg p-5">
          <p className="text-accent text-xs uppercase tracking-wider mb-3">
            with pux
          </p>
          <div className="space-y-2 text-sm text-foreground">
            <p>git push</p>
            <p className="text-accent/40">↓</p>
            <p>
              <span className="text-accent">🐱</span> wakes up
            </p>
            <p className="text-accent/40">↓</p>
            <p>build fails</p>
            <p className="text-accent/40">↓</p>
            <p>context ready</p>
            <p className="text-accent/40">↓</p>
            <p className="text-success">AI fixes it</p>
          </div>
        </div>
      </div>
    </section>
  );
}
