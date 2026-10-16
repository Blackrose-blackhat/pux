import Foundation

/// A failed expectation; its description is what `check` prints after `FAIL <name>:`.
public struct CheckError: Error, CustomStringConvertible {
    public init(_ description: String) { self.description = description }
    public let description: String
}

nonisolated(unsafe) private var failures = 0

/// Runs one named check, printing `ok <name>` or `FAIL <name>: <error>` and recording failures.
public func check(_ name: String, _ body: () throws -> Void) {
    do {
        try body()
        print("ok \(name)")
    } catch {
        failures += 1
        print("FAIL \(name): \(error)")
    }
}

public func expect(_ condition: Bool, _ message: String = "", file: StaticString = #file, line: UInt = #line) throws {
    guard !condition else { return }
    let detail = message.isEmpty ? "expectation failed" : message
    throw CheckError("\(detail) (\(file):\(line))")
}

public func expectEqual<T: Equatable>(_ a: T, _ b: T, file: StaticString = #file, line: UInt = #line) throws {
    guard a != b else { return }
    throw CheckError("expected \(String(reflecting: a)) to equal \(String(reflecting: b)) (\(file):\(line))")
}

/// Exits 0 when every check passed, 1 otherwise.
public func finish() -> Never {
    print(failures == 0 ? "all checks passed" : "\(failures) check(s) failed")
    exit(failures == 0 ? 0 : 1)
}
