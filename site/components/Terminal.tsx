export function Terminal() {
  return (
    <section className="flex justify-center px-4 pb-16">
      <div className="w-full max-w-2xl bg-[#111111] border border-[#2a2a2a] rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2a2a]">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-muted text-xs ml-2">pux watch</span>
        </div>
        <div className="p-4 text-xs sm:text-sm leading-relaxed">
          <div className="flex gap-2 mb-3">
            <pre className="text-accent leading-tight">
              {` /\\_/\\`}
              {"\n"}
              {`( ^.^ )~`}
              {"\n"}
              {` > ^ < `}
            </pre>
            <div className="flex flex-col justify-center">
              <span className="text-accent font-bold">pux</span>
              <span className="text-muted">CI context, ready for your AI</span>
            </div>
          </div>
          <div className="space-y-1">
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-foreground">
                Repository: user/my-app
              </span>
            </p>
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-foreground">Workflow: CI</span>{" "}
              <span className="text-muted">#12847</span>
            </p>
            <p>
              <span className="text-[#eab308]">◌</span>{" "}
              <span className="text-foreground">Running</span>
            </p>
          </div>
          <div className="mt-3 space-y-1">
            <p>
              <span className="text-foreground">Progress </span>
              <span className="text-accent">████████</span>
              <span className="text-muted">░░░░</span>
              <span className="text-foreground"> 6/8 jobs</span>
            </p>
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-muted">lint</span>
            </p>
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-muted">typecheck</span>
            </p>
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-muted">unit-tests</span>
            </p>
            <p>
              <span className="text-success">✓</span>{" "}
              <span className="text-muted">build</span>
            </p>
            <p>
              <span className="text-[#eab308]">◌</span>{" "}
              <span className="text-foreground">deploy</span>
              <span className="text-muted"> · 3/5 steps</span>
            </p>
            <p className="text-muted pl-4">↳ Run deployment script</p>
            <p>
              <span className="text-muted">·</span>{" "}
              <span className="text-muted">e2e-tests</span>
            </p>
          </div>
          <p className="mt-4 text-muted">
            Refreshes every 3s · press q to quit
          </p>
        </div>
      </div>
    </section>
  );
}
