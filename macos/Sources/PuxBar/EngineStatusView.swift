import SwiftUI

/// Shown instead of the repos when the engine can't run: not installed, or offline after
/// repeated crashes.
struct EngineStatusView: View {
    enum Kind: Equatable {
        case install
        case offline(String)
    }

    static let installCommand = "brew install Blackrose-blackhat/pux/pux"

    var kind: Kind
    var onCopy: () -> Void = {}
    var onRetry: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch kind {
            case .install:
                Text("Pux engine not found")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white)
                Text("Install the pux CLI, then reopen Pux:")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.white.opacity(0.55))
                Text(Self.installCommand)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.white)
                    .textSelection(.enabled)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                    .background(Color.white.opacity(0.06))
                Button("Copy", action: onCopy).buttonStyle(PillButtonStyle(primary: true))
            case let .offline(reason):
                Text("Engine offline")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.red)
                ScrollView(.vertical) {
                    Text(reason.isEmpty ? "pux serve exited repeatedly." : reason)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.7))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 84)
                .fixedSize(horizontal: false, vertical: true)
                Button("Retry", action: onRetry).buttonStyle(PillButtonStyle(primary: true))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
