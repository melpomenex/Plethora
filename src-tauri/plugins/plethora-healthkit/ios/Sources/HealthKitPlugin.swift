import Foundation
import Tauri
import UIKit

#if os(iOS)
import HealthKit
#endif

struct AuthArgs: Decodable {
  let categories: [String]
}

struct QueryArgs: Decodable {
  let startMs: Int64
  let endMs: Int64
  let anchorBase64: String?
  let categories: [String]?
  let limit: Int?
}

struct ExcludeDirArgs: Decodable {
  let path: String
}

public class HealthKitPlugin: Plugin {
  #if os(iOS)
  private let healthStore = HKHealthStore()
  private var observerQueries: [HKObserverQuery] = []

  private func readTypes(for categories: [String]) -> Set<HKObjectType> {
    var types = Set<HKObjectType>()
    let requested = categories.isEmpty ? ["sleep"] : categories
    for cat in requested {
      switch cat {
      case "sleep", "sleep_stages":
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
          types.insert(sleepType)
        }
      case "heart_rate":
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) {
          types.insert(hr)
        }
      case "resting_heart_rate":
        if let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) {
          types.insert(rhr)
        }
      case "hrv":
        if let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
          types.insert(hrv)
        }
      case "activity":
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) {
          types.insert(steps)
        }
        if let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
          types.insert(energy)
        }
      default:
        break
      }
    }
    return types
  }

  private func mapSleepStage(_ value: Int) -> (String, String) {
    if #available(iOS 16.0, *) {
      switch HKCategoryValueSleepAnalysis(rawValue: value) {
      case .inBed: return ("in_bed", "inBed")
      case .asleepUnspecified: return ("asleep_unknown", "asleepUnspecified")
      case .awake: return ("awake", "awake")
      case .asleepCore: return ("light", "asleepCore")
      case .asleepDeep: return ("deep", "asleepDeep")
      case .asleepREM: return ("rem", "asleepREM")
      default: return ("unknown", "raw_\(value)")
      }
    } else {
      switch value {
      case HKCategoryValueSleepAnalysis.inBed.rawValue: return ("in_bed", "inBed")
      case HKCategoryValueSleepAnalysis.asleep.rawValue: return ("asleep_unknown", "asleep")
      case HKCategoryValueSleepAnalysis.awake.rawValue: return ("awake", "awake")
      default: return ("unknown", "raw_\(value)")
      }
    }
  }

  private func tzOffsetSeconds(for sample: HKSample) -> Int? {
    if let tzName = sample.metadata?[HKMetadataKeyTimeZone] as? String,
       let tz = TimeZone(identifier: tzName) {
      return tz.secondsFromGMT(for: sample.endDate)
    }
    return TimeZone.current.secondsFromGMT(for: sample.endDate)
  }

  private func serializeSample(_ sample: HKSample) -> JSObject? {
    let startMs = Int64(sample.startDate.timeIntervalSince1970 * 1000.0)
    let endMs = Int64(sample.endDate.timeIntervalSince1970 * 1000.0)
    let tzSecs = tzOffsetSeconds(for: sample) ?? 0
    let wasUserEntered = (sample.metadata?[HKMetadataKeyWasUserEntered] as? Bool) ?? false

    var obj: JSObject = [
      "uuid": sample.uuid.uuidString,
      "startAtMs": startMs,
      "endAtMs": endMs,
      "tzOffsetSecs": tzSecs,
      "sourceBundleId": sample.sourceRevision.source.bundleIdentifier,
      "sourceName": sample.sourceRevision.source.name,
      "wasUserEntered": wasUserEntered,
    ]
    if let manufacturer = sample.device?.manufacturer {
      obj["deviceManufacturer"] = manufacturer
    }
    if let model = sample.device?.model {
      obj["deviceModel"] = model
    }

    if let cat = sample as? HKCategorySample {
      let (stage, code) = mapSleepStage(cat.value)
      obj["kind"] = "sleep"
      obj["stageType"] = stage
      obj["providerStageCode"] = code
      return obj
    }

    if let qty = sample as? HKQuantitySample {
      obj["kind"] = "quantity"
      switch qty.quantityType.identifier {
      case HKQuantityTypeIdentifier.heartRate.rawValue:
        obj["metricType"] = "heart_rate"
        obj["unit"] = "bpm"
        obj["value"] = qty.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
      case HKQuantityTypeIdentifier.restingHeartRate.rawValue:
        obj["metricType"] = "resting_heart_rate"
        obj["unit"] = "bpm"
        obj["value"] = qty.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
      case HKQuantityTypeIdentifier.heartRateVariabilitySDNN.rawValue:
        obj["metricType"] = "hrv"
        obj["hrvMethod"] = "sdnn"
        obj["unit"] = "ms"
        obj["value"] = qty.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli))
      case HKQuantityTypeIdentifier.stepCount.rawValue:
        obj["metricType"] = "steps"
        obj["unit"] = "count"
        obj["value"] = qty.quantity.doubleValue(for: HKUnit.count())
      case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
        obj["metricType"] = "active_calories"
        obj["unit"] = "kcal"
        obj["value"] = qty.quantity.doubleValue(for: HKUnit.kilocalorie())
      default:
        return nil
      }
      return obj
    }

    return nil
  }

  private func decodeAnchor(_ base64: String?) -> HKQueryAnchor? {
    guard let b64 = base64, !b64.isEmpty, let data = Data(base64Encoded: b64) else {
      return nil
    }
    return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
  }

  private func encodeAnchor(_ anchor: HKQueryAnchor?) -> String? {
    guard let anchor = anchor else { return nil }
    guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else {
      return nil
    }
    return data.base64EncodedString()
  }
  #endif

  @objc public func getAvailability(_ invoke: Invoke) throws {
    #if os(iOS)
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.resolve([
        "available": false,
        "reason": "HealthKit data store is unavailable on this iOS/iPadOS device",
        "requestStatus": "unavailable",
        "iosVersion": UIDevice.current.systemVersion,
      ])
      return
    }
    let types = readTypes(for: ["sleep"])
    healthStore.getRequestStatusForAuthorization(toShare: [], read: types) { status, error in
      if let error = error {
        invoke.resolve([
          "available": true,
          "reason": error.localizedDescription,
          "requestStatus": "unknown",
          "iosVersion": UIDevice.current.systemVersion,
        ])
        return
      }
      let statusStr: String
      switch status {
      case .shouldRequest: statusStr = "should_request"
      case .unnecessary: statusStr = "unnecessary"
      case .unknown: statusStr = "unknown"
      @unknown default: statusStr = "unknown"
      }
      invoke.resolve([
        "available": true,
        "requestStatus": statusStr,
        "iosVersion": UIDevice.current.systemVersion,
      ])
    }
    #else
    invoke.resolve([
      "available": false,
      "reason": "platform_unsupported: HealthKit is iOS-only",
      "requestStatus": "unsupported",
    ])
    #endif
  }

  @objc public func requestAuthorization(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthArgs.self)
    #if os(iOS)
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("UNAVAILABLE: HealthKit is unavailable on this device")
      return
    }
    let types = readTypes(for: args.categories)
    guard !types.isEmpty else {
      invoke.reject("INVALID_INPUT: No valid HealthKit categories selected")
      return
    }
    healthStore.requestAuthorization(toShare: nil, read: types) { success, error in
      if let error = error {
        invoke.reject("AUTH_ERROR: \(error.localizedDescription)")
        return
      }
      self.healthStore.getRequestStatusForAuthorization(toShare: [], read: types) { status, _ in
        let statusStr = status == .unnecessary ? "unnecessary" : "should_request"
        invoke.resolve([
          "promptCompleted": success,
          "requestStatus": statusStr,
          "requestedCategories": args.categories,
          "readDenialOpaqueNote": "Apple Health hides read denials as empty query results to protect privacy.",
        ])
      }
    }
    #else
    invoke.reject("platform_unsupported: HealthKit is iOS-only")
    #endif
  }

  @objc public func querySleepSessions(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(QueryArgs.self)
    #if os(iOS)
    runQuery(typeIds: ["sleep"], args: args, invoke: invoke)
    #else
    invoke.reject("platform_unsupported: HealthKit is iOS-only")
    #endif
  }

  @objc public func queryPhysiologicalSamples(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(QueryArgs.self)
    #if os(iOS)
    let cats = args.categories ?? ["heart_rate", "resting_heart_rate", "hrv", "activity"]
    runQuery(typeIds: cats, args: args, invoke: invoke)
    #else
    invoke.reject("platform_unsupported: HealthKit is iOS-only")
    #endif
  }

  @objc public func queryAnchoredChanges(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(QueryArgs.self)
    #if os(iOS)
    let cats = args.categories ?? ["sleep", "heart_rate", "resting_heart_rate", "hrv", "activity"]
    runQuery(typeIds: cats, args: args, invoke: invoke)
    #else
    invoke.reject("platform_unsupported: HealthKit is iOS-only")
    #endif
  }

  #if os(iOS)
  private func runQuery(typeIds: [String], args: QueryArgs, invoke: Invoke) {
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("UNAVAILABLE: HealthKit unavailable")
      return
    }
    let objectTypes = readTypes(for: typeIds).compactMap { $0 as? HKSampleType }
    guard !objectTypes.isEmpty else {
      invoke.resolve([
        "sleepSamples": [] as [JSObject],
        "physioSamples": [] as [JSObject],
        "deletedUuids": [] as [String],
        "anchors": [:] as JSObject,
      ])
      return
    }

    let startDate = Date(timeIntervalSince1970: Double(args.startMs) / 1000.0)
    let endDate = Date(timeIntervalSince1970: Double(args.endMs) / 1000.0)
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)

    var anchorMap: [String: String] = [:]
    if let rawAnchorJson = args.anchorBase64,
       let data = rawAnchorJson.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
      anchorMap = parsed
    }

    let group = DispatchGroup()
    let lock = NSLock()
    var sleepSamples: [JSObject] = []
    var physioSamples: [JSObject] = []
    var deletedUuids: [String] = []
    var nextAnchors: [String: String] = anchorMap
    var firstError: String?

    for sampleType in objectTypes {
      group.enter()
      let key = sampleType.identifier
      let anchor = decodeAnchor(anchorMap[key])
      let limit = args.limit ?? HKObjectQueryNoLimit
      let query = HKAnchoredObjectQuery(
        type: sampleType,
        predicate: anchor == nil ? predicate : nil,
        anchor: anchor,
        limit: limit
      ) { _, added, deleted, newAnchor, error in
        defer { group.leave() }
        lock.lock()
        defer { lock.unlock() }
        if let error = error {
          if firstError == nil {
            firstError = error.localizedDescription
          }
          return
        }
        if let encoded = self.encodeAnchor(newAnchor) {
          nextAnchors[key] = encoded
        }
        for del in deleted ?? [] {
          deletedUuids.append(del.uuid.uuidString)
        }
        for sample in added ?? [] {
          guard let item = self.serializeSample(sample) else { continue }
          if (item["kind"] as? String) == "sleep" {
            sleepSamples.append(item)
          } else {
            physioSamples.append(item)
          }
        }
      }
      healthStore.execute(query)
    }

    group.notify(queue: .main) {
      if let err = firstError, sleepSamples.isEmpty && physioSamples.isEmpty {
        invoke.reject("QUERY_ERROR: \(err)")
        return
      }
      let nextAnchorJson: String?
      if let encodedData = try? JSONSerialization.data(withJSONObject: nextAnchors),
         let str = String(data: encodedData, encoding: .utf8) {
        nextAnchorJson = str
      } else {
        nextAnchorJson = nil
      }
      var res: JSObject = [
        "sleepSamples": sleepSamples,
        "physioSamples": physioSamples,
        "deletedUuids": deletedUuids,
      ]
      if let anchorStr = nextAnchorJson {
        res["nextAnchorJson"] = anchorStr
      }
      invoke.resolve(res)
    }
  }
  #endif

  @objc public func enableBackgroundDelivery(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthArgs.self)
    #if os(iOS)
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("UNAVAILABLE: HealthKit unavailable")
      return
    }
    let sampleTypes = readTypes(for: args.categories).compactMap { $0 as? HKSampleType }
    for sampleType in sampleTypes {
      let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completionHandler, error in
        if error == nil {
          self?.trigger("plethora-healthkit-data-updated", data: [
            "sampleType": sampleType.identifier,
            "timestampMs": Int64(Date().timeIntervalSince1970 * 1000.0),
          ])
        }
        completionHandler()
      }
      healthStore.execute(query)
      observerQueries.append(query)
      healthStore.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { _, _ in }
    }
    invoke.resolve(true)
    #else
    invoke.reject("platform_unsupported: HealthKit is iOS-only")
    #endif
  }

  @objc public func disableBackgroundDelivery(_ invoke: Invoke) throws {
    #if os(iOS)
    for query in observerQueries {
      healthStore.stop(query)
    }
    observerQueries.removeAll()
    healthStore.disableAllBackgroundDelivery { success, _ in
      invoke.resolve(success)
    }
    #else
    invoke.resolve(true)
    #endif
  }

  @objc public func excludeHealthDirFromBackup(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExcludeDirArgs.self)
    #if os(iOS)
    var url = URL(fileURLWithPath: args.path)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    do {
      try url.setResourceValues(values)
      invoke.resolve(true)
    } catch {
      invoke.reject("BACKUP_EXCLUSION_FAILED: \(error.localizedDescription)")
    }
    #else
    invoke.resolve(false)
    #endif
  }
}

@_cdecl("init_plugin_plethora_healthkit")
func initPlugin() -> Plugin {
  return HealthKitPlugin()
}
