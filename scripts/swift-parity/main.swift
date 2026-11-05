// Эталон для tests/parity.test.ts: те же фразы через разбор Mac-версии Komet.
// Запуск: bash scripts/swift-parity.sh (нужна папка ~/Documents/Komet)
import Foundation
Settings.registerDefaults()
let dir = FileManager.default.temporaryDirectory.appendingPathComponent("parity-\(UUID().uuidString)")
try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
let store = Store(database: try! AppDatabase(path: dir.appendingPathComponent("a.sqlite").path))
// Как в тесте: стандартные Учёба/Музыка/Личное, без модели — только правила
UserDefaults.standard.set(false, forKey: Settings.mlEnabled)
let phrases = try! JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
var out: [[String: Any]] = []
for p in phrases {
    let a = TextProcessor.analyze(p)
    out.append(["phrase": p, "kind": a.kind.rawValue, "clean": TextProcessor.clean(p),
                "tasks": a.tasks.map { ["title": $0.title, "area": $0.area.id,
                                        "due": $0.dueDate.map { Dates.daysLeft($0) } ?? -999,
                                        "weekday": $0.dueDate.map { Dates.isoWeekday($0) } ?? 0,
                                        "priority": $0.priority.rawValue, "weak": $0.dueIsWeak] }])
}
let wrapped: [String: Any] = ["generated": Date().timeIntervalSince1970, "timeZone": TimeZone.current.identifier, "results": out]
print(String(data: try! JSONSerialization.data(withJSONObject: wrapped, options: [.sortedKeys, .prettyPrinted]), encoding: .utf8)!)
try? FileManager.default.removeItem(at: dir)
exit(0)
