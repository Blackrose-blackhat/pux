import Foundation

/// A JSON value that keeps object keys in document order and numbers as written, so a file can
/// be read and written back unchanged apart from the edit. `JSONSerialization` can't do this:
/// it reorders keys (NSDictionary) and writes `"key" : value`.
enum OrderedJSON: Equatable {
    case object([Member])
    case array([OrderedJSON])
    case string(String)
    /// The literal as it appeared in the source (or as written by `number(_:)`).
    case number(String)
    case bool(Bool)
    case null

    struct Member: Equatable {
        var key: String
        var value: OrderedJSON
    }

    // MARK: Object helpers

    /// The value for `key`, when this is an object that has it.
    subscript(key: String) -> OrderedJSON? {
        guard case let .object(members) = self else { return nil }
        return members.first { $0.key == key }?.value
    }

    /// Replaces `key`'s value in place, or appends it, like assigning a property in JavaScript.
    mutating func set(_ key: String, _ value: OrderedJSON) {
        guard case var .object(members) = self else { return }
        if let index = members.firstIndex(where: { $0.key == key }) {
            members[index].value = value
        } else {
            members.append(Member(key: key, value: value))
        }
        self = .object(members)
    }

    // MARK: Parsing

    struct ParseError: Error {}

    /// Parses a complete JSON text; throws on anything `JSON.parse` would reject.
    /// A repeated key keeps its first position and its last value, as `JSON.parse` does.
    static func parse(_ text: String) throws -> OrderedJSON {
        var parser = Parser(bytes: Array(text.utf8))
        parser.skipWhitespace()
        let value = try parser.value(depth: 0)
        parser.skipWhitespace()
        guard parser.atEnd else { throw ParseError() }
        return value
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0
        static let maxDepth = 512

        var atEnd: Bool { index >= bytes.count }

        mutating func skipWhitespace() {
            while index < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) { index += 1 }
        }

        mutating func expect(_ byte: UInt8) throws {
            guard index < bytes.count, bytes[index] == byte else { throw ParseError() }
            index += 1
        }

        mutating func literal(_ word: String) throws {
            for byte in word.utf8 { try expect(byte) }
        }

        mutating func value(depth: Int) throws -> OrderedJSON {
            guard depth < Self.maxDepth, index < bytes.count else { throw ParseError() }
            switch bytes[index] {
            case UInt8(ascii: "{"): return try object(depth: depth)
            case UInt8(ascii: "["): return try array(depth: depth)
            case UInt8(ascii: "\""): return .string(try string())
            case UInt8(ascii: "t"): try literal("true"); return .bool(true)
            case UInt8(ascii: "f"): try literal("false"); return .bool(false)
            case UInt8(ascii: "n"): try literal("null"); return .null
            default: return .number(try number())
            }
        }

        mutating func object(depth: Int) throws -> OrderedJSON {
            try expect(UInt8(ascii: "{"))
            var result = OrderedJSON.object([])
            skipWhitespace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "}") { index += 1; return result }
            while true {
                skipWhitespace()
                let key = try string()
                skipWhitespace()
                try expect(UInt8(ascii: ":"))
                skipWhitespace()
                result.set(key, try value(depth: depth + 1))
                skipWhitespace()
                guard index < bytes.count else { throw ParseError() }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                try expect(UInt8(ascii: "}"))
                return result
            }
        }

        mutating func array(depth: Int) throws -> OrderedJSON {
            try expect(UInt8(ascii: "["))
            var items: [OrderedJSON] = []
            skipWhitespace()
            if index < bytes.count, bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
            while true {
                skipWhitespace()
                items.append(try value(depth: depth + 1))
                skipWhitespace()
                guard index < bytes.count else { throw ParseError() }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                try expect(UInt8(ascii: "]"))
                return .array(items)
            }
        }

        mutating func string() throws -> String {
            try expect(UInt8(ascii: "\""))
            var scalars = String.UnicodeScalarView()
            var run: [UInt8] = []   // unescaped UTF-8 bytes since the last escape
            func flush() {
                guard !run.isEmpty else { return }
                // `run` holds whole UTF-8 sequences from a Swift String, so decoding can't fail;
                // unlike String(bytes:encoding:) it keeps a leading U+FEFF.
                scalars.append(contentsOf: String(decoding: run, as: UTF8.self).unicodeScalars)
                run.removeAll()
            }
            while true {
                guard index < bytes.count else { throw ParseError() }
                let byte = bytes[index]
                index += 1
                switch byte {
                case UInt8(ascii: "\""):
                    flush()
                    return String(scalars)
                case UInt8(ascii: "\\"):
                    flush()
                    scalars.append(try escape())
                case 0x00..<0x20:
                    throw ParseError()
                default:
                    run.append(byte)
                }
            }
        }

        mutating func escape() throws -> Unicode.Scalar {
            guard index < bytes.count else { throw ParseError() }
            let byte = bytes[index]
            index += 1
            switch byte {
            case UInt8(ascii: "\""): return "\""
            case UInt8(ascii: "\\"): return "\\"
            case UInt8(ascii: "/"): return "/"
            case UInt8(ascii: "b"): return "\u{08}"
            case UInt8(ascii: "f"): return "\u{0C}"
            case UInt8(ascii: "n"): return "\n"
            case UInt8(ascii: "r"): return "\r"
            case UInt8(ascii: "t"): return "\t"
            case UInt8(ascii: "u"):
                let unit = try hex4()
                if (0xD800..<0xDC00).contains(unit), index + 1 < bytes.count,
                   bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
                    let save = index
                    index += 2
                    let low = try hex4()
                    if (0xDC00..<0xE000).contains(low) {
                        return Unicode.Scalar(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00))!
                    }
                    index = save
                }
                // A lone surrogate can't be held in a Swift String; it becomes U+FFFD.
                return Unicode.Scalar(unit) ?? "\u{FFFD}"
            default:
                throw ParseError()
            }
        }

        mutating func hex4() throws -> UInt32 {
            guard index + 4 <= bytes.count else { throw ParseError() }
            var value: UInt32 = 0
            for byte in bytes[index..<index + 4] {
                guard let digit = Character(Unicode.Scalar(byte)).hexDigitValue else { throw ParseError() }
                value = value * 16 + UInt32(digit)
            }
            index += 4
            return value
        }

        /// `-? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?`, kept as text.
        mutating func number() throws -> String {
            let start = index
            func digits() -> Int {
                let from = index
                while index < bytes.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(bytes[index]) { index += 1 }
                return index - from
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
            guard index < bytes.count else { throw ParseError() }
            if bytes[index] == UInt8(ascii: "0") {
                index += 1
            } else {
                guard digits() > 0 else { throw ParseError() }
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
                index += 1
                guard digits() > 0 else { throw ParseError() }
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
                index += 1
                if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
                guard digits() > 0 else { throw ParseError() }
            }
            return String(decoding: bytes[start..<index], as: UTF8.self)
        }
    }

    // MARK: Writing

    /// The text `JSON.stringify(value, null, 2)` produces for the same value (numbers are written
    /// as they were read, which matches for files the engine wrote).
    func stringified() -> String {
        var out = ""
        write(to: &out, indent: "")
        return out
    }

    private func write(to out: inout String, indent: String) {
        switch self {
        case let .object(members):
            guard !members.isEmpty else { out += "{}"; return }
            let inner = indent + "  "
            out += "{\n"
            for (i, member) in members.enumerated() {
                out += inner
                Self.writeString(member.key, to: &out)
                out += ": "
                member.value.write(to: &out, indent: inner)
                out += i == members.count - 1 ? "\n" : ",\n"
            }
            out += indent + "}"
        case let .array(items):
            guard !items.isEmpty else { out += "[]"; return }
            let inner = indent + "  "
            out += "[\n"
            for (i, item) in items.enumerated() {
                out += inner
                item.write(to: &out, indent: inner)
                out += i == items.count - 1 ? "\n" : ",\n"
            }
            out += indent + "]"
        case let .string(text):
            Self.writeString(text, to: &out)
        case let .number(text):
            out += text
        case let .bool(flag):
            out += flag ? "true" : "false"
        case .null:
            out += "null"
        }
    }

    /// JSON.stringify's escaping: quote, backslash and control characters only.
    private static func writeString(_ text: String, to out: inout String) {
        out += "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case _ where scalar.value < 0x20:
                let hex = String(scalar.value, radix: 16)
                out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
    }
}
