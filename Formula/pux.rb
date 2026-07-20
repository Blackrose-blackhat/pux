class Pux < Formula
  desc "Ambient CI companion – watches pipelines and generates AI-ready failure context"
  homepage "https://github.com/Blackrose-blackhat/pux"
  url "https://registry.npmjs.org/pux.sh/-/pux.sh-0.1.4.tgz"
  sha256 "5664316ec682573417feaefc912ab38911db335ce2fda761a44b65c45059cfe7"
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
