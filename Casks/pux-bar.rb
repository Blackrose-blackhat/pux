cask "pux-bar" do
  version "0.1.5"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/Blackrose-blackhat/pux/releases/download/v#{version}/Pux-#{version}.zip"
  name "Pux"
  desc "Notch bar for Pux: shows CI failures in the MacBook notch"
  homepage "https://github.com/Blackrose-blackhat/pux"

  depends_on formula: "Blackrose-blackhat/pux/pux"
  depends_on macos: ">= :sonoma"

  app "Pux.app"

  zap trash: [
    "~/Library/Preferences/sh.pux.bar.plist",
  ]

  caveats <<~EOS
    Pux.app is ad-hoc signed, not notarized, so macOS blocks the first launch.
    On macOS 15 or newer, open System Settings → Privacy & Security after the
    blocked launch and click "Open Anyway", or clear the quarantine flag:

      xattr -d com.apple.quarantine /Applications/Pux.app

    On macOS 14, right-click the app and choose Open also works.
  EOS
end
