cask "pux-bar" do
  version "0.1.5"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/Blackrose-blackhat/pux/releases/download/v#{version}/Pux-#{version}.zip"
  name "Pux"
  desc "Notch bar for Pux: shows CI failures in the MacBook notch"
  homepage "https://github.com/Blackrose-blackhat/pux"

  depends_on formula: "pux"
  depends_on macos: ">= :sonoma"

  app "Pux.app"

  zap trash: [
    "~/Library/Preferences/sh.pux.bar.plist",
  ]

  caveats <<~EOS
    Pux.app is ad-hoc signed, not notarized. On first launch macOS will block it:
    right-click the app and choose Open, or clear the quarantine flag:

      xattr -d com.apple.quarantine /Applications/Pux.app
  EOS
end
