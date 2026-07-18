export function Problem() {
  return (
    <section className="flex flex-col items-center px-4 py-16 max-w-3xl mx-auto">
      <div className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2a2a]">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="text-muted text-xs ml-2">the problem</span>
        </div>
        <div className="p-5 text-xs sm:text-sm font-mono">
          <pre className="text-muted leading-loose whitespace-pre-wrap">
{`$ git push origin main
remote: Resolving deltas: 100% (3/3), done.

`}<span className="text-foreground"># 20 minutes later...</span>{`

$ open https://github.com/user/app/actions
`}<span className="text-muted"># click run... click job... scroll... scroll... scroll...</span>{`

`}<span className="text-error">{"Error: Cannot find module './utils/auth'"}</span>{`
`}<span className="text-error">{"    at Object.<anonymous> (src/index.ts:4:1)"}</span>{`
`}<span className="text-muted"># hmm, need more context</span>{`

$ git diff HEAD~1 --stat
`}<span className="text-muted"># copy... paste into claude... </span>{`
`}<span className="text-muted"># "can you show me the full file?"</span>{`
`}<span className="text-muted"># copy more... paste again...</span>{`
`}<span className="text-muted"># repeat 4 more times</span>{`

`}<span className="text-foreground"># total time wasted: 25 minutes</span>{`
`}<span className="text-foreground"># tabs opened: 7</span>{`
`}<span className="text-foreground"># context switches: too many</span></pre>

          <div className="border-t border-[#2a2a2a] mt-6 pt-6">
            <pre className="text-foreground leading-loose whitespace-pre-wrap">
{`$ `}<span className="text-accent">pux watch</span>{`

`}<span className="text-[#eab308]">◌</span>{` watching CI for `}<span className="text-muted">a3f29b1</span>{`...

`}<span className="text-error">✗</span>{` build failed

`}<span className="text-success">✓</span>{` wrote .ai-context/failure.md
`}<span className="text-success">✓</span>{` connected to Claude Code, Cursor

`}<span className="text-muted"># AI already has full context:</span>{`
`}<span className="text-muted">#   failed logs, git diff, changed files,</span>{`
`}<span className="text-muted">#   workflow yaml, package.json</span>{`

`}<span className="text-foreground"># total time: 0 minutes</span>{`
`}<span className="text-foreground"># tabs opened: 0</span>{`
`}<span className="text-accent"># just push and forget</span></pre>
          </div>
        </div>
      </div>
    </section>
  );
}
