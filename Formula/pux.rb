class Pux < Formula
  desc "Ambient CI companion – watches pipelines and generates AI-ready failure context"
  homepage "https://github.com/Blackrose-blackhat/pux"
  url "https://registry.npmjs.org/pux.sh/-/pux.sh-0.1.5.tgz"
  sha256 "c8d3eae160a892e32837db3dcae515e843e5383fef52b8141940c8bcf8b6d59f"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/pux"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pux --version")
  end
end
