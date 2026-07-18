export function Footer() {
  return (
    <footer className="flex flex-col items-center px-4 py-12 mt-auto border-t border-[#1a1a1a]">
      <div className="flex gap-6 text-xs text-muted">
        <a
          href="https://github.com/Blackrose-blackhat/pux"
          className="hover:text-foreground transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/pux.sh"
          className="hover:text-foreground transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          npm
        </a>
        <span>MIT License</span>
      </div>
      <p className="text-muted text-xs mt-4">
        built by{" "}
        <a
          href="https://musharraf.codes"
          className="text-accent hover:text-foreground transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Musharaf Parwej
        </a>
      </p>
    </footer>
  );
}
