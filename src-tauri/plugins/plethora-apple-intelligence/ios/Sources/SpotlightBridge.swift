// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// C — add-apple-spotlight-semantic-index

import CoreSpotlight
import Foundation
import Tauri
import UniformTypeIdentifiers

struct SpotlightDonateArgs: Decodable {
  var items: [SpotlightItemArgs]?
}

struct SpotlightItemArgs: Decodable {
  var identifier: String
  var domain: String?
  var title: String?
  var text: String?
  var uri: String?
}

struct SpotlightIdArgs: Decodable {
  var identifier: String?
  var identifiers: [String]?
  var domain: String?
}

struct SpotlightQueryArgs: Decodable {
  var query: String?
  var limit: Int?
}

final class AppleSpotlightBridge {
  private let index = CSSearchableIndex.default()
  private(set) var donatedCount = 0
  private var generation = 0

  func featureState() -> FeatureStatePayload {
    if CSSearchableIndex.isIndexingAvailable() {
      return FeatureStatePayload.available()
    }
    return FeatureStatePayload.unavailable("unsupported_os")
  }

  func status(_ invoke: Invoke) {
    let state = featureState()
    var obj: JSObject = [
      "status": state.status,
      "itemCount": donatedCount,
      "generation": generation,
    ]
    if let reason = state.reason { obj["reason"] = reason }
    invoke.resolve(obj)
  }

  func donate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpotlightDonateArgs.self)
    let items = args.items ?? []
    let searchable = items.map { item -> CSSearchableItem in
      let attrs = CSSearchableItemAttributeSet(itemContentType: UTType.text.identifier)
      attrs.title = item.title
      attrs.textContent = item.text
      attrs.contentURL = item.uri.flatMap { URL(string: $0) }
      return CSSearchableItem(
        uniqueIdentifier: item.identifier,
        domainIdentifier: item.domain ?? "plethora",
        attributeSet: attrs
      )
    }
    index.indexSearchableItems(searchable) { error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      self.donatedCount += searchable.count
      self.generation += 1
      invoke.resolve(["ok": true, "count": searchable.count])
    }
  }

  func delete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpotlightIdArgs.self)
    let ids = args.identifiers ?? (args.identifier.map { [$0] } ?? [])
    index.deleteSearchableItems(withIdentifiers: ids) { error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      self.donatedCount = max(0, self.donatedCount - ids.count)
      self.generation += 1
      invoke.resolve(["ok": true])
    }
  }

  func deleteDomain(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpotlightIdArgs.self)
    let domain = args.domain ?? "plethora"
    index.deleteSearchableItems(withDomainIdentifiers: [domain]) { error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      self.donatedCount = 0
      self.generation += 1
      invoke.resolve(["ok": true])
    }
  }

  func query(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpotlightQueryArgs.self)
    let query = args.query ?? ""
    let limit = args.limit ?? 20
    let escaped = query.replacingOccurrences(of: "\"", with: "")
    let search = CSSearchQuery(
      queryString: "title == \"*\(escaped)*\"c || textContent == \"*\(escaped)*\"c",
      attributes: ["title", "textContent"]
    )
    var hits: [JSObject] = []
    search.foundItemsHandler = { items in
      for item in items {
        if hits.count >= limit { break }
        hits.append([
          "identifier": item.uniqueIdentifier,
          "title": item.attributeSet.title ?? "",
          "uri": item.attributeSet.contentURL?.absoluteString ?? "",
        ])
      }
    }
    search.completionHandler = { error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      invoke.resolve(["hits": hits])
    }
    search.start()
  }

  func rebuild(_ invoke: Invoke) {
    index.deleteAllSearchableItems { error in
      if let error {
        rejectCoded(invoke, "inference_failed", error.localizedDescription)
        return
      }
      self.donatedCount = 0
      self.generation += 1
      invoke.resolve(["ok": true])
    }
  }
}
