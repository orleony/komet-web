import Foundation
// Разбирает тексты расписаний Swift-версией и печатает JSON — для сверки с веб-версией (tests/schedule-parity.test.ts)
let input = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let bells = (input["bells"] as! [[String: Int]]).map { BellSlot(start: $0["start"]!, end: $0["end"]!) }
let now = Date(timeIntervalSince1970: input["now"] as! Double)
func dump(_ list: [ParsedClass]) -> [[String: Any]] {
    list.map { ["weekday": $0.weekday, "number": $0.number ?? NSNull(), "startMin": $0.startMin ?? NSNull(), "endMin": $0.endMin ?? NSNull(),
                "title": $0.title, "teacher": $0.teacher, "room": $0.room, "kind": $0.kind, "parity": $0.parity.rawValue] }
}
var out: [String: Any] = [:]
out["texts"] = (input["texts"] as! [String]).map { dump(ScheduleParser.parse($0, bells: { _ in bells })) }
out["ics"] = (input["ics"] as! [String]).map { dump(ScheduleParser.parseICS($0, parityOf: { _ in .numerator }, bells: bells, now: now)) }
let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
