import Foundation
import XCTest
@testable import plethora_haptics

final class HapticsContractTests: XCTestCase {
  func testSharedBridgeFixtureUsesRustWireContract() throws {
    let bundle = Bundle.module
    let url = try XCTUnwrap(bundle.url(forResource: "bridge-contract", withExtension: "json"))
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let capabilities = try XCTUnwrap(root["capabilities"] as? [String: Any])
    XCTAssertEqual(capabilities["protocolVersion"] as? Int, 1)
    XCTAssertEqual(capabilities["driver"] as? String, "android-native")
    let request = try XCTUnwrap(root["request"] as? [String: Any])
    XCTAssertEqual(request["effect"] as? String, "commit")
    XCTAssertEqual(request["driverSessionId"] as? String, "fixture-session-1")
    XCTAssertEqual((root["submitted"] as? [String: Any])?["status"] as? String, "submitted")
  }

  func testUnknownEffectAndInvalidIdsAreRejectedBySharedValidator() {
    XCTAssertFalse(HapticsWire.effects.contains("vibrate"))
    XCTAssertFalse(HapticsWire.validId("  "))
    XCTAssertFalse(HapticsWire.validId(String(repeating: "x", count: 129)))
    XCTAssertTrue(HapticsWire.validId("stable-action-id"))
  }
}
