import ExpoModulesCore
import Foundation
import Valhalla
import ValhallaConfigModels

// Valhalla を1つだけ作って使い回す（作るときにタイルを mmap するので重い）。
// Valhalla のインスタンスは複数のスレッドから同時に使えないが、ライブラリの中でロックしている
public class CubRoutingModule: Module {
  private var valhalla: Valhalla?
  private var tileExtractPath: String?

  public func definition() -> ModuleDefinition {
    Name("CubRouting")

    // タイルの tar を指定して Valhalla を作る。作るのにかかった時間（ミリ秒）を返す
    AsyncFunction("open") { (tileExtractPath: String) -> Double in
      let started = DispatchTime.now()
      let url = URL(fileURLWithPath: tileExtractPath)
      guard FileManager.default.fileExists(atPath: url.path) else {
        throw TileExtractNotFoundException(tileExtractPath)
      }
      self.valhalla?.close()
      let config = try ValhallaConfig(tileExtractTar: url)
      self.valhalla = try Valhalla(config)
      self.tileExtractPath = tileExtractPath
      return Self.millisecondsSince(started)
    }

    Function("isOpen") { () -> Bool in
      self.valhalla != nil
    }

    // Valhalla の /route と同じ JSON を受け取り、答えの JSON と計算にかかった時間を返す
    AsyncFunction("route") { (requestJson: String) -> [String: Any] in
      guard let valhalla = self.valhalla else {
        throw NotOpenException()
      }
      let started = DispatchTime.now()
      let responseJson = try valhalla.route(rawRequest: requestJson)
      return [
        "responseJson": responseJson,
        "milliseconds": Self.millisecondsSince(started),
      ]
    }

    Function("close") {
      self.valhalla?.close()
      self.valhalla = nil
    }

    // アプリが使っているメモリ（iOS が数える phys_footprint、MB）
    Function("memoryFootprintMegabytes") { () -> Double in
      Self.memoryFootprintMegabytes()
    }
  }

  private static func millisecondsSince(_ started: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
  }

  private static func memoryFootprintMegabytes() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard result == KERN_SUCCESS else { return -1 }
    return Double(info.phys_footprint) / 1_048_576
  }
}

final class TileExtractNotFoundException: GenericException<String> {
  override var reason: String { "タイルの tar が見つからない: \(param)" }
}

final class NotOpenException: Exception {
  override var reason: String { "Valhalla をまだ開いていない（open を先に呼ぶ）" }
}
