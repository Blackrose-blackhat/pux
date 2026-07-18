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
      <p className="text-[#333] text-xs mt-4">
        built by{" "}
        <a
          href="https://github.com/Blackrose-blackhat"
          className="hover:text-muted transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Blackrose-blackhat
        </a>
      </p>
    </footer>
  );
}
