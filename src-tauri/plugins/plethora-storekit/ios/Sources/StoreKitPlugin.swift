// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
//
// iOS implementation of the StoreKit 2 billing Tauri plugin.
//
// All commerce runs through StoreKit 2:
//   - products   : Product.products(for:)            (localized pricing only)
//   - purchase   : product.purchase(options:)         with .appAccountToken
//   - entitlements: Transaction.currentEntitlements    (verified entries only)
//   - restore    : AppStore.sync()
//   - updates    : Transaction.updates → channel event
//                  "plethora-storekit-transaction-update"
//   - manage     : AppStore.showManageSubscriptions (iOS 15+)
//
// Verification semantics (contract): any VerificationResult.unverified is a
// FAILURE — unverified transactions are never returned, never granted, and
// never finished(). Verified transactions carry their signed JWS
// (`jsonRepresentation`) so the Plethora server can re-verify authoritatively.

import Foundation
import StoreKit
import Tauri
import UIKit

/// Decodable argument payloads from Rust/JS.
struct GetProductsArgs: Decodable {
  var ids: [String]?
}

struct PurchaseArgs: Decodable {
  var productId: String
  var appAccountToken: String?
}

struct SetTokenArgs: Decodable {
  var token: String
}

/// Product identifiers shared with the frontend (`src/lib/billing/productIds.ts`)
/// and the committed StoreKit configuration file. IDs only — never prices.
enum PlethoraProducts {
  static let proMonthly = "plethora_pro_monthly"
  static let proAnnual = "plethora_pro_annual"
  static let all: [String] = [proMonthly, proAnnual]

  static let defaultsKey = "plethora.storekit.appAccountToken"
}

@available(iOS 15.0, *)
public class StoreKitPlugin: Plugin {

  /// Held while the Transaction.updates observer task is running.
  private var updatesTask: Task<Void, Never>?

  // ────────────────────────────────────────────────────────────────────────
  // Products (task §2)
  // ────────────────────────────────────────────────────────────────────────

  @objc public func getProducts(_ invoke: Invoke) throws {
    guard requireIOS15(invoke) else { return }
    let args = try invoke.parseArgs(GetProductsArgs.self)
    let ids = (args.ids?.isEmpty == false) ? args.ids! : PlethoraProducts.all

    Task {
      do {
        let products = try await Product.products(for: ids)
        var mapped: [JSObject] = []
        for product in products {
          mapped.append(Self.productPayload(product))
        }
        invoke.resolve(["products": mapped])
      } catch {
        invoke.reject("PRODUCT_QUERY_FAILED: \(error)")
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Purchase (task §3)
  // ────────────────────────────────────────────────────────────────────────

  @objc public func purchase(_ invoke: Invoke) throws {
    guard requireIOS15(invoke) else { return }
    let args = try invoke.parseArgs(PurchaseArgs.self)

    Task {
      do {
        guard let product = try await Product.products(for: [args.productId]).first else {
          invoke.resolve(["outcome": Self.outcomePayload(
            outcome: "failed", reason: "PRODUCT_NOT_FOUND", transaction: nil)])
          return
        }

        var options: Set<Product.PurchaseOption> = []
        if let tokenString = args.appAccountToken, let uuid = UUID(uuidString: tokenString) {
          options.insert(.appAccountToken(uuid))
        }

        let result = try await product.purchase(options: options)
        switch result {
        case .success(let verification):
          switch verification {
          case .verified(let transaction):
            let payload = Self.transactionPayload(transaction)
            await transaction.finish()
            invoke.resolve(["outcome": Self.outcomePayload(
              outcome: "purchased", reason: nil, transaction: payload)])
          case .unverified(_, let error):
            // Unverified JWS: reject; never grant, never finish().
            invoke.resolve(["outcome": Self.outcomePayload(
              outcome: "failed",
              reason: "UNVERIFIED_TRANSACTION: \(error)",
              transaction: nil)])
          }
        case .pending:
          // Ask-to-buy / approval outstanding. Entitlement may arrive later
          // via Transaction.updates + server reconciliation.
          invoke.resolve(["outcome": Self.outcomePayload(
            outcome: "pending", reason: nil, transaction: nil)])
        case .userCancelled:
          invoke.resolve(["outcome": Self.outcomePayload(
            outcome: "userCancelled", reason: nil, transaction: nil)])
        @unknown default:
          invoke.resolve(["outcome": Self.outcomePayload(
            outcome: "failed", reason: "UNKNOWN_PURCHASE_RESULT", transaction: nil)])
        }
      } catch {
        invoke.resolve(["outcome": Self.outcomePayload(
          outcome: "failed", reason: "\(error)", transaction: nil)])
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Entitlements + Restore (task §4)
  // ────────────────────────────────────────────────────────────────────────

  @objc public func currentEntitlements(_ invoke: Invoke) throws {
    guard requireIOS15(invoke) else { return }
    Task {
      var verified: [JSObject] = []
      var unverifiedCount = 0
      for await entitlement in Transaction.currentEntitlements {
        switch entitlement {
        case .verified(let transaction):
          verified.append(Self.transactionPayload(transaction))
        case .unverified:
          unverifiedCount += 1
        }
      }
      if unverifiedCount > 0 {
        Self.log("currentEntitlements dropped \(unverifiedCount) unverified entr(ies)")
      }
      invoke.resolve(["transactions": verified])
    }
  }

  @objc public func restore(_ invoke: Invoke) throws {
    guard requireIOS15(invoke) else { return }
    Task {
      do {
        try await AppStore.sync()
        var verified: [JSObject] = []
        for await entitlement in Transaction.currentEntitlements {
          switch entitlement {
          case .verified(let transaction):
            verified.append(Self.transactionPayload(transaction))
          case .unverified:
            break
          }
        }
        invoke.resolve([
          "restored": true,
          "transactions": verified,
        ])
      } catch {
        invoke.reject("RESTORE_FAILED: \(error)")
      }
    }
  }

  @objc public func startTransactionListener(_ invoke: Invoke) throws {
    guard requireIOS15(invoke) else { return }
    updatesTask?.cancel()
    updatesTask = Task.detached { [weak self] in
      for await update in Transaction.updates {
        guard let self = self else { return }
        switch update {
        case .verified(let transaction):
          let payload = StoreKitPlugin.transactionPayload(transaction)
          await transaction.finish()
          self.trigger(PlethoraEvents.transactionUpdate, data: payload)
        case .unverified(_, let error):
          self.trigger(PlethoraEvents.transactionUpdate, data: [
            "unverified": true,
            "reason": "\(error)",
          ] as JSObject)
        }
      }
    }
    invoke.resolve()
  }

  @objc public func manageSubscriptions(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      invoke.reject("UNSUPPORTED: manage-subscriptions requires iOS 15+")
      return
    }
    DispatchQueue.main.async {
      guard let scene = self.manager.viewController?.view.window?.windowScene else {
        // No scene attached (e.g. background launch): fall back to the URL.
        if let url = URL(string: "itms-apps://apps.apple.com/account/subscriptions") {
          UIApplication.shared.open(url) { opened in
            if !opened { invoke.reject("MANAGE_SUBSCRIPTIONS_FAILED: no scene and URL open failed") }
            else { invoke.resolve() }
          }
        } else {
          invoke.reject("MANAGE_SUBSCRIPTIONS_FAILED: no window scene")
        }
        return
      }
      Task {
        do {
          try await AppStore.showManageSubscriptions(in: scene)
          invoke.resolve()
        } catch {
          invoke.reject("MANAGE_SUBSCRIPTIONS_FAILED: \(error)")
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // appAccountToken persistence (design decision 4)
  // ────────────────────────────────────────────────────────────────────────

  @objc public func setAppAccountToken(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetTokenArgs.self)
    UserDefaults.standard.set(args.token, forKey: PlethoraProducts.defaultsKey)
    invoke.resolve()
  }

  @objc public func getAppAccountToken(_ invoke: Invoke) throws {
    invoke.resolve([
      "token": UserDefaults.standard.string(forKey: PlethoraProducts.defaultsKey) as Any,
    ])
  }

  // ────────────────────────────────────────────────────────────────────────
  // Payload mapping
  // ────────────────────────────────────────────────────────────────────────

  private static func productPayload(_ product: Product) -> JSObject {
    var payload: JSObject = [
      "id": product.id,
      "displayName": product.displayName,
      "description": product.description,
      "priceFormatted": product.displayPrice,
      "period": NSNull(),
    ]

    if let subscription = product.subscription {
      payload["period"] = Self.normalizedPeriod(subscription.subscriptionPeriod)

      if let intro = subscription.introductoryOffer {
        payload["introOffer"] = [
          "displayPrice": intro.displayPrice,
          "periodValue": intro.period.value,
          "periodUnit": Self.periodUnitName(intro.period.unit),
          "paymentMode": Self.paymentModeName(intro.paymentMode),
        ] as JSObject
        if intro.paymentMode == .freeTrial && intro.period.unit == .day {
          payload["trialDays"] = intro.period.value
        }
      }
    }
    return payload
  }

  private static func transactionPayload(_ transaction: Transaction) -> JSObject {
    var payload: JSObject = [
      "originalTransactionId": String(transaction.originalID),
      "transactionId": String(transaction.id),
      "productId": transaction.productID,
      "purchaseDateMs": transaction.purchaseDate.timeIntervalSince1970 * 1000,
      "environment": {
        if #available(iOS 16.0, *) {
          return transaction.environment.rawValue
        }
        return "unknown"
      }(),
      // The signed JWS for authoritative server-side re-verification.
      "jws": String(data: transaction.jsonRepresentation, encoding: .utf8) ?? "",
      "appAccountToken": NSNull(),
    ]
    if let expiration = transaction.expirationDate {
      payload["expirationDateMs"] = expiration.timeIntervalSince1970 * 1000
    }
    if let revocation = transaction.revocationDate {
      payload["revocationDateMs"] = revocation.timeIntervalSince1970 * 1000
    }
    if let token = transaction.appAccountToken {
      payload["appAccountToken"] = token.uuidString
    }
    return payload
  }

  private static func outcomePayload(outcome: String, reason: String?, transaction: JSObject?) -> JSObject {
    var payload: JSObject = ["outcome": outcome]
    payload["reason"] = reason ?? NSNull()
    payload["transaction"] = transaction ?? NSNull()
    return payload
  }

  private static func normalizedPeriod(_ period: Product.SubscriptionPeriod) -> String {
    switch period.unit {
    case .month where period.value >= 12:
      return "annual"
    case .year:
      return "annual"
    case .month:
      return "monthly"
    default:
      return "\(period.value)_\(Self.periodUnitName(period.unit))"
    }
  }

  private static func periodUnitName(_ unit: Product.SubscriptionPeriod.Unit) -> String {
    switch unit {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return "unknown"
    }
  }

  private static func paymentModeName(_ mode: Product.SubscriptionOffer.PaymentMode) -> String {
    switch mode {
    case .freeTrial: return "freeTrial"
    case .payAsYouGo: return "payAsYouGo"
    case .payUpFront: return "payUpFront"
    default: return "unknown"
    }
  }

  private func requireIOS15(_ invoke: Invoke) -> Bool {
    if #available(iOS 15.0, *) { return true }
    invoke.reject("UNSUPPORTED: StoreKit 2 requires iOS 15+")
    return false
  }

  private static func log(_ message: String) {
    NSLog("[plethora-storekit] %@", message)
  }
}

enum PlethoraEvents {
  /// Event name used with the plugin's registerListener channel mechanism.
  /// The Rust command storekit_start_transaction_listener arms the native
  /// observer; events flow through channels registered from the frontend.
  static let transactionUpdate = "plethora-storekit-transaction-update"
}

/// Plugin entry point — must match `ios_plugin_binding!(init_plugin_plethora_storekit)`
/// in src/lib.rs.
@available(iOS 15.0, *)
@_cdecl("init_plugin_plethora_storekit")
func initPlugin() -> Plugin {
  return StoreKitPlugin()
}
