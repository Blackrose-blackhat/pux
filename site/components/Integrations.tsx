export function Integrations() {
  return (
    <section className="flex flex-col items-center px-4 py-10 max-w-3xl mx-auto">
      <p className="text-muted text-xs uppercase tracking-wide mb-6">works with</p>
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.73.083-.73 1.205.085 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0z"/>
          </svg>
          <span className="text-foreground text-sm">GitHub Actions</span>
        </div>
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 22.525H0l12-21.05 12 21.05z"/>
          </svg>
          <span className="text-foreground text-sm">Vercel</span>
        </div>
      </div>
    </section>
  );
}
